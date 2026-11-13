import en from './en.json';
import ptBR from './pt-BR.json';

/**
 * Every user-facing string lives in this folder, one file per language, keyed by screen.
 * Story 1.8 adds the language choice (a cookie before sign-in); until then the language follows
 * the browser's `Accept-Language`, and Portuguese is the default.
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
