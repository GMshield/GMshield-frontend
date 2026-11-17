import en from './en.json';
import ptBR from './pt-BR.json';

/**
 * Every user-facing string lives in this folder, one file per language, keyed by screen.
 * The language comes from the language cookie (src/preferences.ts), else from the browser's
 * `Accept-Language`, and Portuguese is the default.
 */
export const LANGUAGES = ['pt-BR', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];
export const DEFAULT_LANGUAGE: Language = 'pt-BR';

export type Messages = typeof ptBR;

const MESSAGES: Record<Language, Messages> = { 'pt-BR': ptBR, en };

export function messagesFor(language: Language): Messages {
  return MESSAGES[language];
}

function languageOfTag(tag: string): Language | null {
  const primary = tag.trim().toLowerCase().split('-')[0];
  if (primary === 'pt') {
    return 'pt-BR';
  }
  if (primary === 'en') {
    return 'en';
  }
  return null;
}

/** The first supported language in an `Accept-Language` header by weight, else the default. */
export function languageFor(acceptLanguage: string | null | undefined): Language {
  if (!acceptLanguage) {
    return DEFAULT_LANGUAGE;
  }
  const ranked = acceptLanguage
    .split(',')
    .slice(0, 20)
    .map((entry, index) => {
      const [tag = '', ...parameters] = entry.split(';');
      const q = parameters.map((p) => p.trim()).find((p) => p.startsWith('q='));
      const weight = q === undefined ? 1 : Number(q.slice(2));
      return { tag, weight: Number.isFinite(weight) ? weight : 0, index };
    })
    .filter((entry) => entry.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.index - b.index);
  for (const { tag } of ranked) {
    const language = languageOfTag(tag);
    if (language !== null) {
      return language;
    }
  }
  return DEFAULT_LANGUAGE;
}

/** Every dotted path to a string in the message files, such as `preferences.apply`. */
type PathsOf<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${Prefix}${K}` : PathsOf<T[K], `${Prefix}${K}.`>;
}[keyof T & string];
export type MessagePath = PathsOf<Messages>;

/** Values that may fill a `{name}` placeholder: never content, only ids, counts and names. */
export type MessageParams = Readonly<Record<string, string | number>>;

const PLACEHOLDER = /\{(\w+)\}/g;
const UNFILLED = /\{\w+\}/;

/** Fills each `{name}` that `params` has; a placeholder without a value stays as it is. */
export function interpolate(text: string, params: MessageParams = {}): string {
  return text.replace(PLACEHOLDER, (placeholder, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : placeholder,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The string at a dotted path, own properties only, or undefined. */
function lookup(messages: Messages, path: string): string | undefined {
  let node: unknown = messages;
  for (const key of path.split('.')) {
    if (!isRecord(node) || !Object.hasOwn(node, key)) {
      return undefined;
    }
    node = node[key];
  }
  return typeof node === 'string' ? node : undefined;
}

export type Translate = (path: MessagePath, params?: MessageParams) => string;

/** `t(path, params)` for one language: the text at `path`, with `{name}` filled from `params`. */
export function translator(language: Language): Translate {
  const messages = messagesFor(language);
  return (path, params) => {
    const text = lookup(messages, path);
    if (text === undefined) {
      throw new Error(`No message at ${path}`);
    }
    return interpolate(text, params);
  };
}

/** The parts of an RFC 9457 problem detail the interface reads, from any parsed body. */
export type ProblemFields = {
  readonly status: number | null;
  readonly category: string | null;
  readonly code: string | null;
  readonly params: MessageParams;
};

export function problemFields(body: unknown): ProblemFields {
  if (!isRecord(body)) {
    return { status: null, category: null, code: null, params: {} };
  }
  const params: Record<string, string | number> = {};
  if (isRecord(body.params)) {
    for (const [name, value] of Object.entries(body.params)) {
      if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) {
        params[name] = value;
      }
    }
  }
  return {
    status: typeof body.status === 'number' && Number.isInteger(body.status) ? body.status : null,
    category: typeof body.category === 'string' ? body.category : null,
    code: typeof body.code === 'string' ? body.code : null,
    params,
  };
}

/**
 * The text for a backend problem detail (`category`, `code`, `params`): the code's own text, else
 * its category's text, else the generic `server` text. A code or category is never shown.
 */
export function errorText(body: unknown, language: Language): string {
  const errors = messagesFor(language).errors;
  const generic = errors.categories.server;
  const { category, code, params } = problemFields(body);
  if (category === null || !Object.hasOwn(errors.categories, category)) {
    return generic;
  }
  const known = category as keyof typeof errors.categories;
  const categoryText = interpolate(errors.categories[known], params);
  const reasons: Readonly<Record<string, string>> = errors.codes[known];
  const reason = code?.startsWith(`${known}.`) ? code.slice(known.length + 1) : null;
  if (reason === null || !Object.hasOwn(reasons, reason)) {
    return categoryText;
  }
  const text = interpolate(reasons[reason] ?? '', params);
  // A text whose placeholder the problem did not fill falls back to its category's text.
  return UNFILLED.test(text) || text === '' ? categoryText : text;
}

/**
 * The text for a failed material's code (Story 1.15: `material.failure`, such as `ingestion.password_required`): the
 * code's own text, else its category's, else the generic one. The code itself is never shown.
 */
export function failureText(code: string | undefined, language: Language): string {
  const category = code?.split('.')[0] ?? '';
  return errorText({ category, code }, language);
}
