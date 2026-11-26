'use server';

import { refresh, revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import type { CorrectionField, CorrectionValues, RecordCorrectionState, RecordDeleteState } from '@/components/RecordCorrection';
import { errorText, problemFields, translator, type Language } from '@/messages';
import { currentPreferences } from '@/preferences';
import { flash } from '@/server/flash';
import { correctCampaignRecord, correctRecord, deleteCampaignRecord, deleteRecord, getCampaignRecord, getRecord } from '@/server/library';
import { currentSessionToken } from '@/server/session-cookies';

/** An id as the backend mints it; anything else is an item nowhere. */
const ID = /^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$/;
/** At most 15 digits: always a safe integer. */
const VERSION = /^(?:0|[1-9]\d{0,14})$/;
/**
 * Far past every limit (past twice the 8,000 code points of a field's value, each up to two UTF-16 units), so the
 * backend still sees a value too long and names it; only a runaway post is cut.
 */
const MOST = 20_000;
/** Far past the 64 fields a record may have, so the backend still names too many; only a runaway post is cut. */
const MOST_FIELDS = 200;

/** A text as typed, its line breaks as LF: a textarea posts CRLF, which the backend would count and store twice. */
function text(value: FormDataEntryValue | null): string | null {
  return typeof value === 'string' ? value.replaceAll('\r\n', '\n').slice(0, MOST) : null;
}

/** The values the form posted, or null when they are not what the form posts (a name and a value per field). */
function valuesOf(form: FormData): CorrectionValues | null {
  const name = text(form.get('name'));
  const recordType = text(form.get('recordType'));
  const names = form.getAll('fieldName').slice(0, MOST_FIELDS + 1);
  const values = form.getAll('fieldValue').slice(0, MOST_FIELDS + 1);
  if (name === null || recordType === null || names.length !== values.length) {
    return null;
  }
  const fields: { name: string; value: string }[] = [];
  for (let index = 0; index < names.length; index++) {
    const fieldName = text(names[index] ?? null);
    const value = text(values[index] ?? null);
    if (fieldName === null || value === null) {
      return null;
    }
    fields.push({ name: fieldName, value });
  }
  return { name, recordType, fields };
}

/** The part of the form a backend problem is about, or null for one about the whole form. */
function fieldOf(problem: unknown): CorrectionField | null {
  const { code, params } = problemFields(problem);
  const index = typeof params.index === 'number' && Number.isInteger(params.index) && params.index >= 0 ? params.index : null;
  switch (code) {
    case 'record.name_invalid':
      return 'name';
    case 'record.type_invalid':
      return 'recordType';
    case 'record.fields_invalid':
      return 'fields';
    case 'record.field_name_invalid':
      return index === null ? 'fields' : `fieldName:${index}`;
    case 'record.field_value_invalid':
      return index === null ? 'fields' : `fieldValue:${index}`;
    default:
      return null;
  }
}

function refused(serial: number, error: string, field: CorrectionField | null): RecordCorrectionState {
  return { serial, saved: false, error, field, stale: false, currentVersion: null };
}

function invalid(serial: number, language: Language): RecordCorrectionState {
  return refused(serial, errorText({ category: 'request', code: 'request.invalid' }, language), null);
}

/**
 * "Salvar" in a record's correction (Story 4.5), on its system's page (`ground` `system`, `owner` the system's id) or
 * on a search's record page (`ground` `campaign`, `owner` the current campaign's id): the record's name, type key and
 * fields sent on the version the page read. Once the backend has taken it, a toast says "Registro corrigido.", the
 * systems' and the search's pages are revalidated and the page is read again, so it shows the corrected record. A stale
 * version (another tab saved first) reads the record again and answers `{stale, currentVersion}`: the GM's edits stay
 * in the form, and "Manter a minha como nova versão" sends them again on the current version. Any other refusal
 * comes back as its text under the part of the form it is about (the field's position from the problem's `index`),
 * never a code. A malformed form never reaches the backend. The proxy (src/proxy.ts) and Next.js refuse a cross-origin
 * post before this runs.
 */
export async function correctRecordAction(previous: RecordCorrectionState, form: FormData): Promise<RecordCorrectionState> {
  const { language } = await currentPreferences();
  const serial = previous.serial + 1;
  const ground = form.get('ground');
  const owner = form.get('owner');
  const recordId = form.get('recordId');
  const version = form.get('version');
  const values = valuesOf(form);
  if (
    (ground !== 'system' && ground !== 'campaign') ||
    typeof owner !== 'string' ||
    !ID.test(owner) ||
    typeof recordId !== 'string' ||
    !ID.test(recordId) ||
    typeof version !== 'string' ||
    !VERSION.test(version) ||
    values === null
  ) {
    return invalid(serial, language);
  }
  // The signed-in layout has already sent a visitor without a session to the sign-in screen.
  const token = (await currentSessionToken()) ?? '';
  const body = { version: Number(version), name: values.name, recordType: values.recordType, fields: [...values.fields] };
  const result =
    ground === 'system' ? await correctRecord(token, owner, recordId, body) : await correctCampaignRecord(token, owner, recordId, body);
  if (result.ok) {
    await flash('success', translator(language)('systems.records.correct.toast'));
    revalidatePath('/systems/[id]', 'layout');
    revalidatePath('/search', 'layout');
    refresh();
    return { serial, saved: true, error: null, field: null, stale: false, currentVersion: result.data.version };
  }
  if (problemFields(result.problem).code === 'request.stale_version') {
    const current = ground === 'system' ? await getRecord(token, owner, recordId) : await getCampaignRecord(token, owner, recordId);
    if (current.ok) {
      return { serial, saved: false, error: null, field: null, stale: true, currentVersion: current.data.version };
    }
    return refused(serial, errorText(current.problem, language), null);
  }
  return refused(serial, errorText(result.problem, language), fieldOf(result.problem));
}

/** A search's address as a record page posts it (`/search?…`), kept only when it is one; else the search itself. */
function searchBack(value: FormDataEntryValue | null): string {
  if (typeof value !== 'string' || !value.startsWith('/search')) {
    return '/search';
  }
  try {
    const base = 'https://frontend.invalid';
    const url = new URL(value, base);
    return url.origin === base && url.pathname === '/search' ? `/search${url.search}` : '/search';
  } catch {
    return '/search';
  }
}

/**
 * "Excluir" confirmed in a record's page (Story 4.5 part B), on its system's page (`ground` `system`, `owner` the
 * system's id, `recordTypeId` the type whose list it goes back to) or on a search's record page (`ground` `campaign`,
 * `owner` the current campaign's id, `back` the search's address). No version is sent. Once the backend has deleted it,
 * a toast says "Registro excluído.", the whole signed-in layout is revalidated (the record's counts and lists change),
 * and the page goes to the record type's list or back to the search. A record not found (already deleted in another
 * tab, or no longer shown) moves the page on the same way, without the toast. Another refusal comes back as its text,
 * never a code. A
 * malformed form never reaches the backend. The proxy (src/proxy.ts) and Next.js refuse a cross-origin post before
 * this runs.
 */
export async function deleteRecordAction(_previous: RecordDeleteState, form: FormData): Promise<RecordDeleteState> {
  const { language } = await currentPreferences();
  const ground = form.get('ground');
  const owner = form.get('owner');
  const recordId = form.get('recordId');
  const recordTypeId = form.get('recordTypeId');
  if (
    (ground !== 'system' && ground !== 'campaign') ||
    typeof owner !== 'string' ||
    !ID.test(owner) ||
    typeof recordId !== 'string' ||
    !ID.test(recordId) ||
    (ground === 'system' && (typeof recordTypeId !== 'string' || !ID.test(recordTypeId)))
  ) {
    return { error: errorText({ category: 'request', code: 'request.invalid' }, language) };
  }
  // The signed-in layout has already sent a visitor without a session to the sign-in screen.
  const token = (await currentSessionToken()) ?? '';
  const result = ground === 'system' ? await deleteRecord(token, owner, recordId) : await deleteCampaignRecord(token, owner, recordId);
  // Not found: already deleted (another tab) or no longer shown here; the page is dead either way, so it moves on too.
  const gone = !result.ok && problemFields(result.problem).code === 'request.not_found';
  if (!result.ok && !gone) {
    return { error: errorText(result.problem, language) };
  }
  if (result.ok) {
    await flash('success', translator(language)('systems.records.delete.toast'));
  }
  revalidatePath('/', 'layout');
  redirect(
    ground === 'system'
      ? `/systems/${encodeURIComponent(owner)}/record-types/${encodeURIComponent(String(recordTypeId))}`
      : searchBack(form.get('back')),
  );
}
