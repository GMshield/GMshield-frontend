import type { Language, Messages } from '@/messages';
import type { components } from '@/server/backend/generated/public';

/**
 * What the guided upload and the tray share (Story 1.14), with no message file and nothing server-only: the browser
 * gets its texts from the server as {@link UploadTexts}, already in the interface's language.
 */
export type Material = components['schemas']['Material'];
export type MaterialState = Material['state'];
export type Kind = NonNullable<Material['kind']>;
export const KINDS: readonly Kind[] = ['rulebook', 'supplement', 'homebrew', 'campaign_notes', 'other'];
export type UploadLanguage = 'pt-BR' | 'en' | 'detect';
export const UPLOAD_LANGUAGES: readonly UploadLanguage[] = ['pt-BR', 'en', 'detect'];
export type BelongingChoice = 'campaign' | 'system' | 'none';

/** The current campaign and its system, which the "where it belongs" step offers until Epic 3; null without one. */
export type Belonging = {
  readonly campaign: { readonly id: string; readonly name: string };
  readonly system: { readonly id: string; readonly name: string };
} | null;

/** The answers of the dialog, the same for every file of one sending. */
export type Answers = {
  readonly kind: Kind;
  readonly belonging: BelongingChoice;
  readonly language: UploadLanguage;
};

/** Every text the dialog, the tray and the announcements show, in one language. */
export type UploadTexts = {
  readonly language: Language;
  readonly upload: Messages['upload'];
  readonly states: Messages['material']['state'];
  /** "{done} de {total} páginas": the pages of a material being processed (Story 1.15). */
  readonly pages: Messages['material']['pages'];
  /** Problem texts by code (`upload.too_large`) and by category (`upload`); `server` is the fallback. */
  readonly errors: Readonly<Record<string, string>>;
};

/** States in which a material is still moving: the tray refreshes while one of its rows is in one. */
export const MOVING_STATES: readonly MaterialState[] = ['uploading', 'waiting', 'processing'];

const PLACEHOLDER = /\{(\w+)\}/g;

/** Fills each `{name}` that `params` has (the browser's own copy of `interpolate`). */
export function fill(text: string, params: Readonly<Record<string, string | number>> = {}): string {
  return text.replace(PLACEHOLDER, (placeholder, name: string) => (Object.hasOwn(params, name) ? String(params[name]) : placeholder));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The text for a problem detail: its code's, else its category's, else the generic one. A code is never shown. */
export function problemText(problem: unknown, errors: UploadTexts['errors']): string {
  const fallback = errors.server ?? '';
  if (!isRecord(problem)) {
    return fallback;
  }
  const code = typeof problem.code === 'string' ? problem.code : null;
  const category = typeof problem.category === 'string' ? problem.category : null;
  if (code !== null && Object.hasOwn(errors, code)) {
    return errors[code] ?? fallback;
  }
  if (category !== null && Object.hasOwn(errors, category)) {
    return errors[category] ?? fallback;
  }
  return fallback;
}

/** The last segment of an upload's address: its id. */
export function uploadIdOf(uploadUrl: string): string {
  return uploadUrl.split('/').filter((part) => part !== '').pop() ?? '';
}

/** A size in bytes, in the interface's language: "12,3 MB". */
export function formatSize(bytes: number, language: Language): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  return `${new Intl.NumberFormat(language, { maximumFractionDigits: unit === 0 ? 0 : 1 }).format(value)} ${units[unit]}`;
}
