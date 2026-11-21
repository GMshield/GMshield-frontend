import { cookies, headers } from 'next/headers';

import { LANGUAGES, languageFor, type Language } from '@/messages';

import { SIDEBAR_COOKIE, sidebarFrom, type SidebarState } from './sidebar-cookie';
import { VIEW_COOKIE, viewsFrom, type ListViews } from './view-cookie';

/**
 * Theme and language before sign-in: two cookies, read by the server on every request, so the
 * page is rendered in the right theme and never flashes another one. Nothing here is stored in the
 * backend (that comes with Epic 8). Only values on the allowlists below are ever used.
 */
export const THEMES = ['illustrated', 'dark', 'light'] as const;
export type Theme = (typeof THEMES)[number];
export const DEFAULT_THEME: Theme = 'illustrated';

export const THEME_COOKIE = '__Host-gmshield-theme';
export const LANGUAGE_COOKIE = '__Host-gmshield-lang';

/** One year; `__Host-` requires `Secure`, `Path=/` and no `Domain`. */
export const PREFERENCE_COOKIE_OPTIONS = {
  secure: true,
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  maxAge: 365 * 24 * 60 * 60,
} as const;

export type Preferences = { readonly theme: Theme; readonly language: Language };

export function themeFrom(value: unknown): Theme | null {
  return THEMES.find((theme) => theme === value) ?? null;
}

export function languageFrom(value: unknown): Language | null {
  return LANGUAGES.find((language) => language === value) ?? null;
}

/** The stored choice where it is valid; else the default theme and the browser's language. */
export function preferencesFor(
  stored: { readonly theme?: string | undefined; readonly language?: string | undefined },
  acceptLanguage: string | null | undefined,
): Preferences {
  return {
    theme: themeFrom(stored.theme) ?? DEFAULT_THEME,
    language: languageFrom(stored.language) ?? languageFor(acceptLanguage),
  };
}

/**
 * The sidebar's state on a wide screen (Story 1.11): `__Host-gmshield-sidebar`, defined in `./sidebar-cookie`
 * so that the sidebar, a client component, can write it without importing the server's `next/headers`.
 */
export { SIDEBAR_COOKIE, SIDEBAR_STATES, sidebarFrom, type SidebarState } from './sidebar-cookie';

/** The sidebar's state of the request being rendered (Server Components only). */
export async function currentSidebar(): Promise<SidebarState> {
  return sidebarFrom((await cookies()).get(SIDEBAR_COOKIE)?.value);
}

/**
 * How each list is shown (usability pass, 2026-11-21): `__Host-gmshield-view`, defined in `./view-cookie` so that the
 * "Exibição" menu, a client component, can write it. Server Components only.
 */
export async function currentViews(): Promise<ListViews> {
  return viewsFrom((await cookies()).get(VIEW_COOKIE)?.value);
}

/** The preferences of the request being rendered (Server Components and Server Actions only). */
export async function currentPreferences(): Promise<Preferences> {
  const [jar, requestHeaders] = await Promise.all([cookies(), headers()]);
  return preferencesFor(
    { theme: jar.get(THEME_COOKIE)?.value, language: jar.get(LANGUAGE_COOKIE)?.value },
    requestHeaders.get('accept-language'),
  );
}
