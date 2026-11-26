'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { fieldOf, typedText, valuesOf } from '@/app/(signed-in)/records/form-values';
import { errorText, problemFields, translator, type Language } from '@/messages';
import { currentPreferences } from '@/preferences';
import { createArtifact } from '@/server/artifacts';
import { flash } from '@/server/flash';
import { currentSessionToken } from '@/server/session-cookies';

import type { ArtifactFormField, ArtifactFormState, ArtifactFormValues } from './form-state';
import { fromOf } from './texts';

/** An id as the backend mints it; anything else is an item nowhere. */
const ID = /^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$/;
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
