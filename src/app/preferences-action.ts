'use server';

import { cookies } from 'next/headers';

import { LANGUAGE_COOKIE, PREFERENCE_COOKIE_OPTIONS, THEME_COOKIE, languageFrom, themeFrom } from '@/preferences';

/**
 * The Server Action behind PreferencesForm. It sets each cookie whose submitted value is on its
 * allowlist and ignores anything else; Next.js then renders the page again with the new cookies.
 * The proxy (src/proxy.ts) and Next.js both refuse a cross-origin POST before it gets here.
 */
export async function savePreferences(form: FormData): Promise<void> {
  const theme = themeFrom(form.get('theme'));
  const language = languageFrom(form.get('language'));
  const jar = await cookies();
  if (theme !== null) {
    jar.set(THEME_COOKIE, theme, PREFERENCE_COOKIE_OPTIONS);
  }
  if (language !== null) {
    jar.set(LANGUAGE_COOKIE, language, PREFERENCE_COOKIE_OPTIONS);
  }
}
