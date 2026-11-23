'use server';

import { redirect } from 'next/navigation';

import type { SystemDeleteState } from '@/components/SystemActions';
import { errorText, problemFields, translator, type Language } from '@/messages';
import { currentPreferences } from '@/preferences';
import { changeSystem, createSystem, deleteSystem, getSystem } from '@/server/library';
import { flash } from '@/server/flash';
import { currentSessionToken } from '@/server/session-cookies';

import type { SystemField, SystemFormState, SystemFormValues } from './form-state';

/**
 * The Server Actions of the systems pages (Story 3.1): a new system and an edit of one (their lists are paged by the
 * address since the third round of the usability pass, with no action). The backend checks every field; a refusal comes back as text under the field it is about (or under the
 * form), never a code, with what was typed kept. A new or edited system opens its page. An edit that the backend finds
 * stale (`request.stale_version`) comes back with the system's current values and version, and says so. The proxy
 * (src/proxy.ts) and Next.js refuse a cross-origin post before any of these runs.
 *
 * Story 3.1 part B: the delete of a system, confirmed in its dialog, which opens the list of systems.
 */

/** An id as the backend mints it; anything else is an item nowhere. */
const ID = /^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$/;
/** At most 15 digits: always a safe integer. */
const VERSION = /^(?:0|[1-9]\d{0,14})$/;
/** Far past every limit, so the backend still sees a value too long and names it; only a runaway post is cut. */
const MOST = 10_000;

/** A field as typed, its line breaks as LF: a textarea posts CRLF, which the backend would count and store twice. */
function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value.replaceAll('\r\n', '\n').slice(0, MOST) : '';
}

function valuesOf(form: FormData): SystemFormValues {
  return { name: text(form, 'name'), edition: text(form, 'edition'), description: text(form, 'description') };
}

/** The field a backend problem is about, or null for one about the whole form. */
function fieldOf(problem: unknown): SystemField | null {
  switch (problemFields(problem).code) {
    case 'request.system_name_invalid':
    case 'request.system_name_taken':
      return 'name';
    case 'request.system_edition_invalid':
      return 'edition';
    case 'request.system_description_invalid':
      return 'description';
    default:
      return null;
  }
}

function invalid(language: Language): string {
  return errorText({ category: 'request', code: 'request.invalid' }, language);
}

/** "Criar sistema": the new system's page, or the form again with the refusal under its field. */
export async function createSystemAction(_previous: SystemFormState, form: FormData): Promise<SystemFormState> {
  const { language } = await currentPreferences();
  const values = valuesOf(form);
  // The signed-in layout has already sent a visitor without a session to the sign-in screen.
  const token = await currentSessionToken();
  const result = await createSystem(token ?? '', {
    name: values.name,
    edition: values.edition,
    description: values.description,
  });
  if (result.ok) {
    await flash('success', translator(language)('feedback.systemCreated', { name: result.data.name }));
    redirect(`/systems/${encodeURIComponent(result.data.id)}`);
  }
  return { values, version: null, error: errorText(result.problem, language), field: fieldOf(result.problem), stale: false };
}

/**
 * "Salvar" on a system's edit page: the system's page, or the form again. Every field is sent, so a cleared edition or
 * description is removed. A stale version brings the system's current values and version into the form.
 */
export async function changeSystemAction(previous: SystemFormState, form: FormData): Promise<SystemFormState> {
  const { language } = await currentPreferences();
  const values = valuesOf(form);
  const id = form.get('id');
  const version = form.get('version');
  if (typeof id !== 'string' || !ID.test(id) || typeof version !== 'string' || !VERSION.test(version)) {
    return { values, version: previous.version, error: invalid(language), field: null, stale: false };
  }
  const token = (await currentSessionToken()) ?? '';
  const result = await changeSystem(token, id, {
    version: Number(version),
    name: values.name,
    edition: values.edition,
    description: values.description,
  });
  if (result.ok) {
    await flash('success', translator(language)('feedback.systemChanged', { name: result.data.name }));
    redirect(`/systems/${encodeURIComponent(id)}`);
  }
  if (problemFields(result.problem).code === 'request.stale_version') {
    const current = await getSystem(token, id);
    if (current.ok) {
      const { name, edition, description } = current.data;
      return {
        values: { name, edition: edition ?? '', description: description ?? '' },
        version: current.data.version,
        error: translator(language)('systems.form.stale'),
        field: null,
        stale: true,
      };
    }
    return { values, version: Number(version), error: errorText(current.problem, language), field: null, stale: false };
  }
  return { values, version: Number(version), error: errorText(result.problem, language), field: fieldOf(result.problem), stale: false };
}

/**
 * "Excluir sistema" in a system's confirmation: the backend deletes it (its campaigns, their conversations and the
 * materials attached only to it go in the background) and the list of systems opens without it. A refusal comes back
 * as its text; a malformed id never reaches the backend.
 */
export async function deleteSystemAction(_previous: SystemDeleteState, form: FormData): Promise<SystemDeleteState> {
  const { language } = await currentPreferences();
  const id = form.get('id');
  if (typeof id !== 'string' || !ID.test(id)) {
    return { error: invalid(language) };
  }
  const result = await deleteSystem((await currentSessionToken()) ?? '', id);
  if (result.ok) {
    await flash('success', translator(language)('feedback.systemDeleted'));
    redirect('/systems');
  }
  return { error: errorText(result.problem, language) };
}
