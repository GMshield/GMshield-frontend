'use server';

import { refresh, revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { fieldOf, typedText, valuesOf } from '@/app/(signed-in)/records/form-values';
import { errorText, problemFields, translator, type Language } from '@/messages';
import { pagingOf } from '@/paging';
import { currentPreferences } from '@/preferences';
import type { ArtifactDeleteState } from '@/components/ArtifactDeleteAction';
import type { OverrideTargetsPage } from '@/components/artifacts/OverridePicker';
import {
  createArtifact,
  deleteArtifact,
  getArtifact,
  overrideTargets,
  relate,
  relationTargets,
  removeOverride,
  restoreArtifact,
  setOverride,
  unrelate,
  updateArtifact,
} from '@/server/artifacts';
import { flash } from '@/server/flash';
import { currentSessionToken } from '@/server/session-cookies';

import type {
  ArtifactEditState,
  ArtifactFormField,
  ArtifactFormState,
  ArtifactFormValues,
  ArtifactOverrideState,
  ArtifactRelationState,
  ArtifactRestoreState,
} from './form-state';
import { OVERRIDE_PAGE_SIZE, RELATION_PAGE_SIZE } from './form-state';
import { artifactBack, fromOf } from './texts';

/** An id as the backend mints it; anything else is an item nowhere. */
const ID = /^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$/;
/** A version's number, from 1, as the backend takes it (at most nine digits). */
const NUMBER = /^[1-9]\d{0,8}$/;
/**
 * Far past the content's limit (past twice its 20,000 code points, each up to two UTF-16 units), so the backend still
 * sees a content too long and names it; only a runaway post is cut.
 */
const MOST_CONTENT = 50_000;
/** The parts a field problem may name (`params.field`), each with its own text under `artifacts.errors`. */
const FIELDS = ['name', 'recordType', 'fields', 'fieldName', 'fieldValue', 'content'] as const;

/** The part of the form a backend problem is about: a record's part, or the content; null for the whole form. */
function artifactFieldOf(problem: unknown): ArtifactFormField | null {
  const { code, params } = problemFields(problem);
  return code === 'request.invalid' && params.field === 'content' ? 'content' : fieldOf(problem);
}

/**
 * The text of a refusal: a value outside its limits (`request.invalid` naming its field) by the field's own text with
 * its limits, anything else as every other refusal reads; never a code.
 */
function refusalText(problem: unknown, language: Language): string {
  const { code, params } = problemFields(problem);
  const field = FIELDS.find((name) => name === params.field);
  if (code === 'request.invalid' && field !== undefined) {
    return translator(language)(`artifacts.errors.${field}`, params);
  }
  return errorText(problem, language);
}

/**
 * "Salvar" on a new artifact's form (Story 5.1): the campaign's id, the record type's key, the name, the fields in order
 * and the content, sent as typed (the backend trims and checks every value). Once the backend has stored it, a toast
 * says "Artefato salvo.", the whole signed-in layout is revalidated (the campaign's lists change), and the artifact's
 * page opens (with `from=characters` when the form was opened from "Personagens", so its way back leads there). A refusal comes back as its text under the part of the form it is about (the field's position from the
 * problem's `index`), with what was typed kept; a campaign that is gone (deleted meanwhile, another owner's) is said
 * under the form. A malformed form never reaches the backend. The proxy (src/proxy.ts) and Next.js refuse a
 * cross-origin post before this runs.
 */
export async function createArtifactAction(previous: ArtifactFormState, form: FormData): Promise<ArtifactFormState> {
  const { language } = await currentPreferences();
  const serial = previous.serial + 1;
  const campaignId = form.get('campaignId');
  const record = valuesOf(form);
  const content = typedText(form.get('content'), MOST_CONTENT) ?? '';
  const values: ArtifactFormValues =
    record === null ? previous.values : { recordType: record.recordType, name: record.name, fields: record.fields, content };
  if (typeof campaignId !== 'string' || !ID.test(campaignId) || record === null) {
    return { serial, values, error: errorText({ category: 'request', code: 'request.invalid' }, language), field: null };
  }
  // The signed-in layout has already sent a visitor without a session to the sign-in screen.
  const token = (await currentSessionToken()) ?? '';
  const result = await createArtifact(token, campaignId, {
    recordType: record.recordType,
    name: record.name,
    fields: [...record.fields],
    content: content === '' ? null : content,
  });
  if (result.ok) {
    await flash('success', translator(language)('feedback.artifactSaved'));
    revalidatePath('/', 'layout');
    // Opened from "Personagens", the artifact's page leads back there (only that one place is ever named).
    const from = fromOf(form.get('from'));
    redirect(`/campaigns/${encodeURIComponent(campaignId)}/artifacts/${encodeURIComponent(result.data.id)}${from === null ? '' : `?from=${from}`}`);
  }
  return { serial, values, error: refusalText(result.problem, language), field: artifactFieldOf(result.problem) };
}

function editRefused(serial: number, error: string, field: ArtifactFormField | null): ArtifactEditState {
  return { serial, saved: false, error, field, stale: false, currentVersion: null };
}

/**
 * "Salvar" in an artifact's edit (Story 5.2): the campaign's and the artifact's ids, the newest version the page read,
 * and the record type's key, name, fields in order and content as typed (the backend trims and checks every value).
 * Once the backend has stored the next version, a toast says "Artefato atualizado.", the whole signed-in layout is
 * revalidated (the campaign's lists and "Personagens" show the new name and type) and the page is read again, which
 * shows the new version. A stale version (another tab saved first) reads the artifact again and answers
 * `{stale, currentVersion}`: the GM's draft stays in the form, and "Manter a minha como nova versão" sends it again on
 * that version. Any other refusal comes back as its text under the part of the form it is about, never a code. A
 * malformed form never reaches the backend. The proxy (src/proxy.ts) and Next.js refuse a cross-origin post before
 * this runs.
 */
export async function updateArtifactAction(previous: ArtifactEditState, form: FormData): Promise<ArtifactEditState> {
  const { language } = await currentPreferences();
  const serial = previous.serial + 1;
  const campaignId = form.get('campaignId');
  const artifactId = form.get('artifactId');
  const version = form.get('version');
  const record = valuesOf(form);
  const content = typedText(form.get('content'), MOST_CONTENT);
  if (
    typeof campaignId !== 'string' ||
    !ID.test(campaignId) ||
    typeof artifactId !== 'string' ||
    !ID.test(artifactId) ||
    typeof version !== 'string' ||
    !NUMBER.test(version) ||
    record === null ||
    content === null
  ) {
    return editRefused(serial, errorText({ category: 'request', code: 'request.invalid' }, language), null);
  }
  // The signed-in layout has already sent a visitor without a session to the sign-in screen.
  const token = (await currentSessionToken()) ?? '';
  const result = await updateArtifact(token, campaignId, artifactId, {
    version: Number(version),
    recordType: record.recordType,
    name: record.name,
    fields: [...record.fields],
    content: content === '' ? null : content,
  });
  if (result.ok) {
    await flash('success', translator(language)('feedback.artifactUpdated'));
    revalidatePath('/', 'layout');
    refresh();
    return { serial, saved: true, error: null, field: null, stale: false, currentVersion: result.data.version };
  }
  if (problemFields(result.problem).code === 'request.stale_version') {
    const current = await getArtifact(token, campaignId, artifactId);
    if (current.ok) {
      return { serial, saved: false, error: null, field: null, stale: true, currentVersion: current.data.currentVersion };
    }
    return editRefused(serial, errorText(current.problem, language), null);
  }
  return editRefused(serial, refusalText(result.problem, language), artifactFieldOf(result.problem));
}

/**
 * "Restaurar" on a row of an artifact's versions (Story 5.2): the campaign's and the artifact's ids, the version to
 * restore (`number`) and the newest version the page read (`version`). Once the backend has copied it as the next
 * version, a toast says "Versão N restaurada." and the whole signed-in layout is revalidated; a page that showed the
 * newest version is read again, and one that showed an earlier version (`view` `older`) moves on to the artifact's
 * page, which shows the newest (keeping `from=characters`). A stale version reads the artifact again and answers
 * `{stale, currentVersion}`, so "Manter a minha como nova versão" sends the same restore again on it. A version whose
 * type the system no longer has, and any other refusal, come back as their text, never a code. A malformed form never
 * reaches the backend.
 */
export async function restoreArtifactAction(previous: ArtifactRestoreState, form: FormData): Promise<ArtifactRestoreState> {
  const { language } = await currentPreferences();
  const serial = previous.serial + 1;
  const campaignId = form.get('campaignId');
  const artifactId = form.get('artifactId');
  const number = form.get('number');
  const version = form.get('version');
  const refused = (error: string, restored: number | null): ArtifactRestoreState => ({
    serial,
    number: restored,
    saved: false,
    error,
    stale: false,
    currentVersion: null,
  });
  if (
    typeof campaignId !== 'string' ||
    !ID.test(campaignId) ||
    typeof artifactId !== 'string' ||
    !ID.test(artifactId) ||
    typeof number !== 'string' ||
    !NUMBER.test(number) ||
    typeof version !== 'string' ||
    !NUMBER.test(version)
  ) {
    return refused(errorText({ category: 'request', code: 'request.invalid' }, language), null);
  }
  const restored = Number(number);
  // The signed-in layout has already sent a visitor without a session to the sign-in screen.
  const token = (await currentSessionToken()) ?? '';
  const result = await restoreArtifact(token, campaignId, artifactId, restored, Number(version));
  if (result.ok) {
    await flash('success', translator(language)('feedback.artifactRestored', { number: restored }));
    revalidatePath('/', 'layout');
    if (form.get('view') === 'older') {
      const from = fromOf(form.get('from'));
      redirect(`/campaigns/${encodeURIComponent(campaignId)}/artifacts/${encodeURIComponent(artifactId)}${from === null ? '' : `?from=${from}`}`);
    }
    refresh();
    return { serial, number: restored, saved: true, error: null, stale: false, currentVersion: result.data.version };
  }
  if (problemFields(result.problem).code === 'request.stale_version') {
    const current = await getArtifact(token, campaignId, artifactId);
    if (current.ok) {
      return { serial, number: restored, saved: false, error: null, stale: true, currentVersion: current.data.currentVersion };
    }
    return refused(errorText(current.problem, language), restored);
  }
  const { code, params } = problemFields(result.problem);
  // The version's type is no longer one of the system's: said as such, not as a choice to make in a form.
  const typeGone = code === 'request.invalid' && params.field === 'recordType';
  return refused(typeGone ? translator(language)('artifacts.versions.typeGone') : errorText(result.problem, language), restored);
}

/** The most of an artifact's name a toast names (its limit is 200 code points); only a runaway post is cut. */
const MOST_NAME = 1_000;

/**
 * "Excluir artefato" confirmed on an artifact's page (Story 5.2 part B): the campaign's and the artifact's ids, its name
 * (for the toast) and where the page was opened from (`from=characters`). Once the backend has recorded the deletion, a
 * toast says "Artefato «Espada de Kael» excluído.", the whole signed-in layout is revalidated (the campaign's lists,
 * counts and "Personagens" change), and the page goes to the campaign's artifacts tab, or to "Personagens" when it was
 * opened from there. An artifact not found (already deleted in another tab) moves the page on the same way, without
 * the toast. Another refusal comes back as its text, never a code. A malformed form never reaches the backend. The proxy
 * (src/proxy.ts) and Next.js refuse a cross-origin post before this runs.
 */
export async function deleteArtifactAction(_previous: ArtifactDeleteState, form: FormData): Promise<ArtifactDeleteState> {
  const { language } = await currentPreferences();
  const campaignId = form.get('campaignId');
  const artifactId = form.get('artifactId');
  const name = typedText(form.get('name'), MOST_NAME);
  if (typeof campaignId !== 'string' || !ID.test(campaignId) || typeof artifactId !== 'string' || !ID.test(artifactId) || name === null) {
    return { error: errorText({ category: 'request', code: 'request.invalid' }, language) };
  }
  // The signed-in layout has already sent a visitor without a session to the sign-in screen.
  const token = (await currentSessionToken()) ?? '';
  const result = await deleteArtifact(token, campaignId, artifactId);
  // Not found: already deleted (another tab) or no longer the campaign's; the page is dead either way, so it moves on.
  const gone = !result.ok && problemFields(result.problem).code === 'request.not_found';
  if (!result.ok && !gone) {
    return { error: errorText(result.problem, language) };
  }
  const t = translator(language);
  if (result.ok) {
    await flash('success', t('feedback.artifactDeleted', { name }));
  }
  revalidatePath('/', 'layout');
  redirect(artifactBack(campaignId, fromOf(form.get('from')), t).href);
}

/** A record type key, as the backend takes one; anything else lists nothing. */
const KEY = /^[a-z][a-z0-9_]{0,31}$/;
/** The longest name filter the backend takes, in code points (`RecordRelations.MAX_QUERY`). */
const MOST_QUERY = 200;

/** The text of a refused mark: the record taken by another artifact, or no target any more; else as every refusal. */
function overrideRefusal(problem: unknown, language: Language): string {
  const t = translator(language);
  const { code } = problemFields(problem);
  if (code === 'artifact.override_taken') {
    return t('artifacts.override.taken');
  }
  if (code === 'artifact.override_target') {
    return t('artifacts.override.target');
  }
  return errorText(problem, language);
}

/**
 * "Substituir" in an artifact's override picker (Story 5.5 part A): the campaign's and the artifact's ids and the
 * record picked. Once the backend has stored the mark, a toast says "Substituição salva. Vale a partir da próxima
 * pergunta.", the whole signed-in layout is revalidated and the page is read again, which shows the record. A record
 * another artifact of the campaign overrides already, or one that is no longer a target, comes back as its own text;
 * any other refusal as every refusal reads, never a code. A malformed form never reaches the backend.
 */
export async function setOverrideAction(previous: ArtifactOverrideState, form: FormData): Promise<ArtifactOverrideState> {
  const { language } = await currentPreferences();
  const serial = previous.serial + 1;
  const campaignId = form.get('campaignId');
  const artifactId = form.get('artifactId');
  const recordId = form.get('recordId');
  if (
    typeof campaignId !== 'string' ||
    !ID.test(campaignId) ||
    typeof artifactId !== 'string' ||
    !ID.test(artifactId) ||
    typeof recordId !== 'string' ||
    !ID.test(recordId)
  ) {
    return { serial, done: false, error: errorText({ category: 'request', code: 'request.invalid' }, language) };
  }
  // The signed-in layout has already sent a visitor without a session to the sign-in screen.
  const token = (await currentSessionToken()) ?? '';
  const result = await setOverride(token, campaignId, artifactId, recordId);
  if (!result.ok) {
    return { serial, done: false, error: overrideRefusal(result.problem, language) };
  }
  const t = translator(language);
  await flash('success', `${t('feedback.artifactOverrideSet')} ${t('artifacts.edit.saved')}`);
  revalidatePath('/', 'layout');
  refresh();
  return { serial, done: true, error: null };
}

/**
 * "Remover substituição" on an artifact's page (Story 5.5 part A): the campaign's and the artifact's ids. Once the
 * backend has dropped the mark (also when another tab dropped it first), a toast says "Substituição removida. Vale a
 * partir da próxima pergunta.", the layout is revalidated and the page is read again. A refusal comes back as its
 * text, never a code. A malformed form never reaches the backend.
 */
export async function removeOverrideAction(previous: ArtifactOverrideState, form: FormData): Promise<ArtifactOverrideState> {
  const { language } = await currentPreferences();
  const serial = previous.serial + 1;
  const campaignId = form.get('campaignId');
  const artifactId = form.get('artifactId');
  if (typeof campaignId !== 'string' || !ID.test(campaignId) || typeof artifactId !== 'string' || !ID.test(artifactId)) {
    return { serial, done: false, error: errorText({ category: 'request', code: 'request.invalid' }, language) };
  }
  // The signed-in layout has already sent a visitor without a session to the sign-in screen.
  const token = (await currentSessionToken()) ?? '';
  const result = await removeOverride(token, campaignId, artifactId);
  if (!result.ok) {
    return { serial, done: false, error: errorText(result.problem, language) };
  }
  const t = translator(language);
  await flash('success', `${t('feedback.artifactOverrideRemoved')} ${t('artifacts.edit.saved')}`);
  revalidatePath('/', 'layout');
  refresh();
  return { serial, done: true, error: null };
}

/**
 * Page `page` of the records an artifact of the campaign can override (Story 5.5 part A), for the override picker:
 * those of the type key `recordType` whose name contains `query` (case and accents ignored; blank for all),
 * {@link OVERRIDE_PAGE_SIZE} a page, alphabetical. A malformed request lists nothing; a refusal comes back as its
 * text. Nothing is written.
 */
export async function overrideTargetsAction(
  campaignId: string,
  recordType: string,
  query: string,
  page: number,
): Promise<OverrideTargetsPage> {
  const { language } = await currentPreferences();
  const at = Number.isInteger(page) && page >= 1 && page <= 10_000 ? page : 1;
  if (!ID.test(campaignId) || !KEY.test(recordType) || typeof query !== 'string') {
    return { ok: false, error: errorText({ category: 'request', code: 'request.invalid' }, language) };
  }
  const q = [...query.trim()].slice(0, MOST_QUERY).join('');
  // The signed-in layout has already sent a visitor without a session to the sign-in screen.
  const token = (await currentSessionToken()) ?? '';
  const offset = (at - 1) * OVERRIDE_PAGE_SIZE;
  const result = await overrideTargets(token, campaignId, {
    recordType,
    ...(q === '' ? {} : { q }),
    offset,
    limit: OVERRIDE_PAGE_SIZE,
  });
  if (!result.ok) {
    return { ok: false, error: errorText(result.problem, language) };
  }
  return {
    ok: true,
    rows: result.data.items.map((item) => ({ id: item.id, name: item.name, materialName: item.materialName })),
    paging: pagingOf(result.data.total, offset, result.data.items.length, OVERRIDE_PAGE_SIZE),
  };
}

/** The text of a refused relation: no target any more, or one side full; else as every refusal. */
function relationRefusal(problem: unknown, language: Language): string {
  const t = translator(language);
  const { code } = problemFields(problem);
  if (code === 'artifact.relation_target') {
    return t('artifacts.relations.target');
  }
  if (code === 'artifact.relations_full') {
    return t('artifacts.relations.full');
  }
  return errorText(problem, language);
}

/**
 * "Relacionar" in an artifact's record picker, related mode (Story 5.5 part B): the campaign's and the artifact's ids
 * and the record picked. Once the backend has stored the relation (or found it there already, from either side), a
 * toast says "Relação salva.", the whole signed-in layout is revalidated and the page is read again, which lists the
 * record. A relation changes no answer, so the toast says nothing about the next question. A record that is no longer
 * a target, or a side that has 50 relations already, comes back as its own text; any other refusal as every refusal
 * reads, never a code. A malformed form never reaches the backend.
 */
export async function relateAction(previous: ArtifactRelationState, form: FormData): Promise<ArtifactRelationState> {
  const { language } = await currentPreferences();
  const serial = previous.serial + 1;
  const campaignId = form.get('campaignId');
  const artifactId = form.get('artifactId');
  const recordId = form.get('recordId');
  if (
    typeof campaignId !== 'string' ||
    !ID.test(campaignId) ||
    typeof artifactId !== 'string' ||
    !ID.test(artifactId) ||
    typeof recordId !== 'string' ||
    !ID.test(recordId)
  ) {
    return { serial, done: false, error: errorText({ category: 'request', code: 'request.invalid' }, language) };
  }
  // The signed-in layout has already sent a visitor without a session to the sign-in screen.
  const token = (await currentSessionToken()) ?? '';
  const result = await relate(token, campaignId, artifactId, recordId);
  if (!result.ok) {
    return { serial, done: false, error: relationRefusal(result.problem, language) };
  }
  await flash('success', translator(language)('feedback.artifactRelationSet'));
  revalidatePath('/', 'layout');
  refresh();
  return { serial, done: true, error: null };
}

/**
 * "Remover" on a row of an artifact's "Relacionados" (Story 5.5 part B): the campaign's and the artifact's ids and the
 * related record's. Once the backend has removed the relation (also when it was gone already), a toast says "Relação
 * removida.", the layout is revalidated and the page is read again. A refusal comes back as its text, never a code. A
 * malformed form never reaches the backend.
 */
export async function unrelateAction(previous: ArtifactRelationState, form: FormData): Promise<ArtifactRelationState> {
  const { language } = await currentPreferences();
  const serial = previous.serial + 1;
  const campaignId = form.get('campaignId');
  const artifactId = form.get('artifactId');
  const recordId = form.get('recordId');
  if (
    typeof campaignId !== 'string' ||
    !ID.test(campaignId) ||
    typeof artifactId !== 'string' ||
    !ID.test(artifactId) ||
    typeof recordId !== 'string' ||
    !ID.test(recordId)
  ) {
    return { serial, done: false, error: errorText({ category: 'request', code: 'request.invalid' }, language) };
  }
  // The signed-in layout has already sent a visitor without a session to the sign-in screen.
  const token = (await currentSessionToken()) ?? '';
  const result = await unrelate(token, campaignId, artifactId, recordId);
  if (!result.ok) {
    return { serial, done: false, error: errorText(result.problem, language) };
  }
  await flash('success', translator(language)('feedback.artifactRelationRemoved'));
  revalidatePath('/', 'layout');
  refresh();
  return { serial, done: true, error: null };
}

/** The tiers a relation target may have; anything else shows no pill. */
const TIERS = new Set(['campaign', 'system', 'other']);

/**
 * Page `page` of the records the artifact `artifactId` of the campaign can be related to (Story 5.5 part B), for the
 * picker's related mode: those of the type key `recordType` whose name contains `query` (case and accents ignored;
 * blank for all), {@link RELATION_PAGE_SIZE} a page, alphabetical, each with its tier; another artifact reads
 * "Artefato desta campanha" where a record names its material. A malformed request lists nothing; a refusal comes back
 * as its text. Nothing is written.
 */
export async function relationTargetsAction(
  campaignId: string,
  artifactId: string,
  recordType: string,
  query: string,
  page: number,
): Promise<OverrideTargetsPage> {
  const { language } = await currentPreferences();
  const at = Number.isInteger(page) && page >= 1 && page <= 10_000 ? page : 1;
  if (!ID.test(campaignId) || !ID.test(artifactId) || !KEY.test(recordType) || typeof query !== 'string') {
    return { ok: false, error: errorText({ category: 'request', code: 'request.invalid' }, language) };
  }
  const q = [...query.trim()].slice(0, MOST_QUERY).join('');
  // The signed-in layout has already sent a visitor without a session to the sign-in screen.
  const token = (await currentSessionToken()) ?? '';
  const offset = (at - 1) * RELATION_PAGE_SIZE;
  const result = await relationTargets(token, campaignId, artifactId, {
    recordType,
    ...(q === '' ? {} : { q }),
    offset,
    limit: RELATION_PAGE_SIZE,
  });
  if (!result.ok) {
    return { ok: false, error: errorText(result.problem, language) };
  }
  const t = translator(language);
  return {
    ok: true,
    rows: result.data.items.map((item) => ({
      id: item.id,
      name: item.name,
      materialName: item.artifact ? t('artifacts.relations.artifact') : (item.materialName ?? ''),
      ...(TIERS.has(item.tier) ? { tier: item.tier } : {}),
    })),
    paging: pagingOf(result.data.total, offset, result.data.items.length, RELATION_PAGE_SIZE),
  };
}
