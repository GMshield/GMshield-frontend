'use server';

import { refresh, revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import type { MoreState } from '@/components/ItemList';
import { errorText, problemFields, translator, type Language } from '@/messages';
import { currentPreferences } from '@/preferences';
import { changeCampaign, chooseCampaign, createCampaign, getCampaign, listCampaigns } from '@/server/library';
import { currentSessionToken } from '@/server/session-cookies';

import type { CampaignActionState, CampaignField, CampaignFormState, CampaignFormValues } from './form-state';
import { campaignListRow } from './rows';

/**
 * The Server Actions of the campaigns pages and of the campaign switcher (Story 3.2): a new campaign (it becomes the
 * current one, and its page opens), a rename, an archive or a restore, the choice of the current campaign, "Abrir" on a
 * campaign's conversation, and "Carregar mais" under Minhas Mesas. The backend checks every field; a refusal comes back
 * as text under the field it is about (or under the form, or under the pill), never a code. A rename the backend finds
 * stale comes back with the campaign's current name and version, and says so. The current campaign is the backend's:
 * nothing about it is kept in the browser. A create, a rename and "Abrir" change what the shared signed-in layout
 * shows (the switcher and the context bar), so each revalidates the layout before it redirects: a redirect alone renders
 * only the destination below that layout, which kept the previous campaign until the next load. The proxy
 * (src/proxy.ts) and Next.js refuse a cross-origin post before any of these runs.
 */

/** An id as the backend mints it; anything else is an item nowhere. */
const ID = /^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$/;
/** At most 15 digits: always a safe integer. */
const VERSION = /^(?:0|[1-9]\d{0,14})$/;
/** Far past the limit, so the backend still sees a name too long and names it; only a runaway post is cut. */
const MOST = 10_000;

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value.slice(0, MOST) : '';
}

function valuesOf(form: FormData): CampaignFormValues {
  return { name: text(form, 'name'), systemId: text(form, 'systemId') };
}

/** The field a backend problem is about, or null for one about the whole form. */
function fieldOf(problem: unknown): CampaignField | null {
  switch (problemFields(problem).code) {
    case 'request.campaign_name_invalid':
    case 'request.campaign_name_taken':
      return 'name';
    default:
      return null;
  }
}

function invalid(language: Language): string {
  return errorText({ category: 'request', code: 'request.invalid' }, language);
}

/** "Criar campanha": the new campaign's page (it is now the current one), or the form again with the refusal. */
export async function createCampaignAction(_previous: CampaignFormState, form: FormData): Promise<CampaignFormState> {
  const { language } = await currentPreferences();
  const values = valuesOf(form);
  if (!ID.test(values.systemId)) {
    return { values, version: null, error: invalid(language), field: 'systemId', stale: false };
  }
  // The signed-in layout has already sent a visitor without a session to the sign-in screen.
  const token = (await currentSessionToken()) ?? '';
  const result = await createCampaign(token, { name: values.name, systemId: values.systemId });
  if (result.ok) {
    revalidatePath('/', 'layout');
    redirect(`/campaigns/${encodeURIComponent(result.data.id)}`);
  }
  // A system that is gone (deleted meanwhile, or another owner's) is said under its choice.
  const field = problemFields(result.problem).code === 'request.not_found' ? 'systemId' : fieldOf(result.problem);
  return { values, version: null, error: errorText(result.problem, language), field, stale: false };
}

/**
 * "Salvar" on a campaign's rename page: the campaign's page, or the form again. A stale version brings the campaign's
 * current name and version into the form.
 */
export async function renameCampaignAction(previous: CampaignFormState, form: FormData): Promise<CampaignFormState> {
  const { language } = await currentPreferences();
  const values = valuesOf(form);
  const id = form.get('id');
  const version = form.get('version');
  if (typeof id !== 'string' || !ID.test(id) || typeof version !== 'string' || !VERSION.test(version)) {
    return { values, version: previous.version, error: invalid(language), field: null, stale: false };
  }
  const token = (await currentSessionToken()) ?? '';
  const result = await changeCampaign(token, id, { version: Number(version), name: values.name });
  if (result.ok) {
    revalidatePath('/', 'layout');
    redirect(`/campaigns/${encodeURIComponent(id)}`);
  }
  if (problemFields(result.problem).code === 'request.stale_version') {
    const current = await getCampaign(token, id);
    if (current.ok) {
      return {
        values: { name: current.data.name, systemId: '' },
        version: current.data.version,
        error: translator(language)('campaigns.form.stale'),
        field: null,
        stale: true,
      };
    }
    return { values, version: Number(version), error: errorText(current.problem, language), field: null, stale: false };
  }
  return { values, version: Number(version), error: errorText(result.problem, language), field: fieldOf(result.problem), stale: false };
}

/**
 * "Arquivar" or "Restaurar" on a campaign's page (the form's `archived`: `true` or `false`), on the version the page
 * was read at. Reversible, so it asks no confirmation. The page is refreshed either way, so it shows the campaign as
 * the backend has it; a refusal (a stale version: it changed elsewhere) comes back as its text.
 */
export async function archiveCampaignAction(previous: CampaignActionState, form: FormData): Promise<CampaignActionState> {
  const { language } = await currentPreferences();
  const id = form.get('id');
  const version = form.get('version');
  const archived = form.get('archived');
  if (typeof id !== 'string' || !ID.test(id) || typeof version !== 'string' || !VERSION.test(version) || (archived !== 'true' && archived !== 'false')) {
    return { ...previous, error: invalid(language) };
  }
  const result = await changeCampaign((await currentSessionToken()) ?? '', id, { version: Number(version), archived: archived === 'true' });
  refresh();
  return result.ok ? { error: null, done: previous.done + 1 } : { ...previous, error: errorText(result.problem, language) };
}

/**
 * A campaign picked in the switcher, or "Usar esta campanha" on its page: it becomes the current campaign, and the
 * page is refreshed, so the conversation, the context bar and the switcher act on it. A refusal (an archived campaign,
 * one gone meanwhile) comes back as its text.
 */
export async function chooseCampaignAction(previous: CampaignActionState, form: FormData): Promise<CampaignActionState> {
  const { language } = await currentPreferences();
  const id = form.get('id');
  if (typeof id !== 'string' || !ID.test(id)) {
    return { ...previous, error: invalid(language) };
  }
  const result = await chooseCampaign((await currentSessionToken()) ?? '', id);
  refresh();
  return result.ok ? { error: null, done: previous.done + 1 } : { ...previous, error: errorText(result.problem, language) };
}

/** "Abrir" on a campaign's conversation: the campaign becomes the current one, and Consultas opens on it. */
export async function openConversationAction(previous: CampaignActionState, form: FormData): Promise<CampaignActionState> {
  const { language } = await currentPreferences();
  const id = form.get('id');
  if (typeof id !== 'string' || !ID.test(id)) {
    return { ...previous, error: invalid(language) };
  }
  const result = await chooseCampaign((await currentSessionToken()) ?? '', id);
  if (result.ok) {
    revalidatePath('/', 'layout');
    redirect('/questions');
  }
  return { ...previous, error: errorText(result.problem, language) };
}

/** "Carregar mais" under Minhas Mesas: the next page after `cursor`, of the archived campaigns when `archived` is true. */
export async function moreCampaignsAction(previous: MoreState, form: FormData): Promise<MoreState> {
  const { language } = await currentPreferences();
  const cursor = form.get('cursor');
  const archived = form.get('archived');
  if (typeof cursor !== 'string' || !ID.test(cursor) || (archived !== 'true' && archived !== 'false')) {
    return { ...previous, error: invalid(language) };
  }
  const t = translator(language);
  const page = await listCampaigns((await currentSessionToken()) ?? '', { archived: archived === 'true', cursor });
  if (!page.ok) {
    return { ...previous, error: errorText(page.problem, language) };
  }
  const rows = page.data.items.map((campaign) => campaignListRow(campaign, t));
  return { rows: [...previous.rows, ...rows], nextCursor: page.data.nextCursor ?? null, error: null, added: rows.length };
}
