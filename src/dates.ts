import type { Language } from './messages';

/**
 * The day a dated item was written, in the interface's language ("21 de nov. de 2026"); UTC, so server and browser
 * agree. A plain module, so a server page (Story 5.2: an artifact's versions) and a client component (a material's
 * superseded versions) both call it; the text itself when it is not a date.
 */
export function uploadDay(createdAt: string, language: Language): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) {
    return createdAt;
  }
  return new Intl.DateTimeFormat(language, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
}
