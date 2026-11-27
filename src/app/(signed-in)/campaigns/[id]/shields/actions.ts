'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { errorText, problemFields, translator, type Language } from '@/messages';
import { currentPreferences } from '@/preferences';
import { flash } from '@/server/flash';
import { currentSessionToken } from '@/server/session-cookies';
import { createShield, getShield, renameShield } from '@/server/shields';

import { shieldName } from '../../rows';

import type { ShieldFormState } from './form-state';

/**
 * The Server Actions of a campaign's Shields (Story 6.1): a new Shield and a rename. The backend checks the name; a
 * refusal comes back as text under the name (or under the form), never a code, with what was typed kept and no toast. A
 * success says so with a toast (`flash`), renders the shared layout again and opens the Shield's screen. A rename the
 * backend finds stale comes back with the Shield's current stored name (empty for the unnamed first Shield) and version,
 * and says so. Malformed ids or versions
 * never reach the backend. The proxy (src/proxy.ts) and Next.js refuse a cross-origin post before any of these runs.
 */

/** An id as the backend mints it; anything else is an item nowhere. */
const ID = /^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$/;
/** At most 15 digits: always a safe integer. */
const VERSION = /^(?:0|[1-9]\d{0,14})$/;
/** Far past the limit, so the backend still sees a name too long and names it; only a runaway post is cut. */
const MOST = 10_000;

function nameOf(form: FormData): string {
  const value = form.get('name');
  return typeof value === 'string' ? value.slice(0, MOST) : '';
}

/** Whether a backend problem is about the name (else it is shown under the whole form). */
function aboutName(problem: unknown): 'name' | null {
  const { code } = problemFields(problem);
  return code === 'request.shield_name_invalid' || code === 'request.shield_name_taken' ? 'name' : null;
}

function invalid(language: Language): string {
  return errorText({ category: 'request', code: 'request.invalid' }, language);
}

function shieldPath(campaignId: string, shieldId: string): string {
  return `/campaigns/${encodeURIComponent(campaignId)}/shields/${encodeURIComponent(shieldId)}`;
}

/** "Criar escudo": the new Shield's screen, with a toast, or the form again with the refusal. */
export async function createShieldAction(_previous: ShieldFormState, form: FormData): Promise<ShieldFormState> {
  const { language } = await currentPreferences();
  const t = translator(language);
  const values = { name: nameOf(form) };
  const campaignId = form.get('campaign');
  if (typeof campaignId !== 'string' || !ID.test(campaignId)) {
    return { values, version: null, error: invalid(language), field: null, stale: false };
  }
  // The signed-in layout has already sent a visitor without a session to the sign-in screen.
  const result = await createShield((await currentSessionToken()) ?? '', campaignId, { name: values.name });
  if (result.ok) {
    await flash('success', t('feedback.shieldCreated', { name: shieldName(result.data, t) }));
    revalidatePath('/', 'layout');
    redirect(shieldPath(campaignId, result.data.id));
  }
  return { values, version: null, error: errorText(result.problem, language), field: aboutName(result.problem), stale: false };
}

/**
 * "Salvar" on a Shield's rename page: the Shield's screen, with a toast, or the form again. A stale version brings the
 * Shield's current name and version into the form.
 */
export async function renameShieldAction(previous: ShieldFormState, form: FormData): Promise<ShieldFormState> {
  const { language } = await currentPreferences();
  const t = translator(language);
  const values = { name: nameOf(form) };
  const campaignId = form.get('campaign');
  const shieldId = form.get('id');
  const version = form.get('version');
  if (
    typeof campaignId !== 'string' ||
    !ID.test(campaignId) ||
    typeof shieldId !== 'string' ||
    !ID.test(shieldId) ||
    typeof version !== 'string' ||
    !VERSION.test(version)
  ) {
    return { values, version: previous.version, error: invalid(language), field: null, stale: false };
  }
  const token = (await currentSessionToken()) ?? '';
  const result = await renameShield(token, campaignId, shieldId, { version: Number(version), name: values.name });
  if (result.ok) {
    await flash('success', t('feedback.shieldRenamed', { name: shieldName(result.data, t) }));
    revalidatePath('/', 'layout');
    redirect(shieldPath(campaignId, shieldId));
  }
  if (problemFields(result.problem).code === 'request.stale_version') {
    const current = await getShield(token, campaignId, shieldId);
    if (current.ok) {
      return {
        values: { name: current.data.name ?? '' },
        version: current.data.version,
        error: t('shields.form.stale'),
        field: null,
        stale: true,
      };
    }
    return { values, version: Number(version), error: errorText(current.problem, language), field: null, stale: false };
  }
  return { values, version: Number(version), error: errorText(result.problem, language), field: aboutName(result.problem), stale: false };
}
