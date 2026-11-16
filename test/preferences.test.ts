import { afterEach, describe, expect, it, vi } from 'vitest';

type SetCall = { name: string; value: string; options: Record<string, unknown> };
let setCalls: SetCall[] = [];
let cookieJar: Record<string, string> = {};
let acceptLanguage: string | null = null;
vi.mock('next/headers', () => ({
  headers: async () => new Headers(acceptLanguage === null ? {} : { 'accept-language': acceptLanguage }),
  cookies: async () => ({
    get: (name: string) => (Object.hasOwn(cookieJar, name) ? { name, value: cookieJar[name] } : undefined),
    set: (name: string, value: string, options: Record<string, unknown>) => {
      setCalls.push({ name, value, options });
      cookieJar[name] = value;
    },
  }),
}));

const preferences = await import('@/preferences');
const { savePreferences } = await import('@/app/preferences-action');
const { DEFAULT_THEME, LANGUAGE_COOKIE, THEME_COOKIE, currentPreferences, languageFrom, preferencesFor, themeFrom } = preferences;

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(values)) {
    data.set(name, value);
  }
  return data;
}

describe('preferences', () => {
  afterEach(() => {
    setCalls = [];
    cookieJar = {};
    acceptLanguage = null;
  });

  it('names the cookies with the __Host- prefix', () => {
    expect(THEME_COOKIE).toBe('__Host-gmshield-theme');
    expect(LANGUAGE_COOKIE).toBe('__Host-gmshield-lang');
    expect(DEFAULT_THEME).toBe('illustrated');
  });

  it('accepts only the allowlisted values', () => {
    for (const theme of ['illustrated', 'dark', 'light']) {
      expect(themeFrom(theme)).toBe(theme);
    }
    for (const language of ['pt-BR', 'en']) {
      expect(languageFrom(language)).toBe(language);
    }
    for (const value of ['<script>', 'Dark', ' dark', 'dark ', '', 'constructor', '__proto__', null, undefined, 1, {}, ['dark']]) {
      expect(themeFrom(value), String(value)).toBeNull();
    }
    for (const value of ['fr', 'pt', 'pt-br', 'EN', 'en-US', '', 'toString', null, undefined]) {
      expect(languageFrom(value), String(value)).toBeNull();
    }
  });

  it('first visit: no cookies, Accept-Language en-US', () => {
    expect(preferencesFor({}, 'en-US')).toEqual({ theme: 'illustrated', language: 'en' });
  });

  it('stored choice: the cookies, whatever the browser sends', () => {
    expect(preferencesFor({ theme: 'light', language: 'pt-BR' }, 'en-US,en;q=0.9')).toEqual({ theme: 'light', language: 'pt-BR' });
  });

  it('tampered cookies: the default theme and the browser language', () => {
    expect(preferencesFor({ theme: '<script>', language: 'fr' }, 'en')).toEqual({ theme: 'illustrated', language: 'en' });
    expect(preferencesFor({ theme: '<script>', language: 'fr' }, null)).toEqual({ theme: 'illustrated', language: 'pt-BR' });
  });

  it('reads the request cookies and headers', async () => {
    acceptLanguage = 'en';
    cookieJar = { [THEME_COOKIE]: 'dark' };
    expect(await currentPreferences()).toEqual({ theme: 'dark', language: 'en' });
  });

  it('change: the action sets both cookies (Secure, HttpOnly, SameSite=Lax, Path=/, one year), and the next render uses them', async () => {
    acceptLanguage = 'pt-BR';
    await savePreferences(form({ theme: 'dark', language: 'en' }));
    const options = { secure: true, httpOnly: true, sameSite: 'lax', path: '/', maxAge: 31_536_000 };
    expect(setCalls).toEqual([
      { name: THEME_COOKIE, value: 'dark', options },
      { name: LANGUAGE_COOKIE, value: 'en', options },
    ]);
    expect(await currentPreferences()).toEqual({ theme: 'dark', language: 'en' });
  });

  it('the action ignores a value off the allowlist', async () => {
    await savePreferences(form({ theme: '<script>', language: 'en' }));
    expect(setCalls.map((call) => call.name)).toEqual([LANGUAGE_COOKIE]);
    setCalls = [];
    await savePreferences(form({ theme: 'light', language: 'fr' }));
    expect(setCalls.map((call) => [call.name, call.value])).toEqual([[THEME_COOKIE, 'light']]);
    setCalls = [];
    await savePreferences(new FormData());
    expect(setCalls).toEqual([]);
  });
});
