import { isValidElement, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

let acceptLanguage: string | null = null;
let cookieJar: Record<string, string> = {};
vi.mock('next/headers', () => ({
  headers: async () => new Headers(acceptLanguage === null ? {} : { 'accept-language': acceptLanguage }),
  cookies: async () => ({
    get: (name: string) => (Object.hasOwn(cookieJar, name) ? { name, value: cookieJar[name] } : undefined),
  }),
}));

const { default: RootLayout, generateMetadata } = await import('@/app/layout');
const { default: HomePage } = await import('@/app/page');
const { default: NotFound } = await import('@/app/not-found');
const { PreferencesForm } = await import('@/components/PreferencesForm');
const { languageFor, messagesFor } = await import('@/messages');
const ptBR = (await import('@/messages/pt-BR.json')).default;
const en = (await import('@/messages/en.json')).default;

type Props = { lang?: string; 'data-theme'?: string; children?: unknown };

async function renderLayout() {
  const html = (await RootLayout({ children: null })) as ReactElement<Props>;
  expect(isValidElement(html)).toBe(true);
  expect(html.type).toBe('html');
  return html.props;
}

describe('page (GET /)', () => {
  afterEach(() => {
    acceptLanguage = null;
    cookieJar = {};
  });

  it('sets <html lang> from the browser language without a cookie, Portuguese by default', async () => {
    for (const [header, lang] of [
      [null, 'pt-BR'],
      ['en-US,en;q=0.9', 'en'],
      ['pt-BR,pt;q=0.9,en;q=0.8', 'pt-BR'],
      ['fr-FR,fr;q=0.9', 'pt-BR'],
      ['fr;q=1, en;q=0.5, pt;q=0.4', 'en'],
      ['en;q=0.2, pt;q=0.8', 'pt-BR'],
      ['en;q=0', 'pt-BR'],
    ] as const) {
      acceptLanguage = header;
      expect((await renderLayout()).lang, String(header)).toBe(lang);
    }
  });

  it('first visit: the illustrated theme and the browser language', async () => {
    acceptLanguage = 'en-US';
    const props = await renderLayout();
    expect(props['data-theme']).toBe('illustrated');
    expect(props.lang).toBe('en');
  });

  it('stored choice: the cookies win over the browser', async () => {
    acceptLanguage = 'en-US,en;q=0.9';
    cookieJar = { '__Host-gmshield-theme': 'light', '__Host-gmshield-lang': 'pt-BR' };
    const props = await renderLayout();
    expect(props['data-theme']).toBe('light');
    expect(props.lang).toBe('pt-BR');
    expect((await generateMetadata()).description).toBe(ptBR.app.description);
  });

  it('tampered cookies are ignored: the default theme and the browser language', async () => {
    acceptLanguage = 'en';
    cookieJar = { '__Host-gmshield-theme': '<script>', '__Host-gmshield-lang': 'fr' };
    const props = await renderLayout();
    expect(props['data-theme']).toBe('illustrated');
    expect(props.lang).toBe('en');
  });

  it('shows the scaffold text and the preferences form in the chosen language', async () => {
    acceptLanguage = 'en';
    cookieJar = { '__Host-gmshield-theme': 'dark' };
    const page = (await HomePage()) as ReactElement<Props>;
    expect(JSON.stringify(page.props.children)).toContain(en.home.lead);
    const form = (page.props.children as ReactElement[]).find((child) => isValidElement(child) && child.type === PreferencesForm);
    expect(form?.props).toEqual({ theme: 'dark', language: 'en' });
    expect((await generateMetadata()).title).toBe(en.app.title);
    acceptLanguage = null;
    expect(JSON.stringify(((await HomePage()) as ReactElement<Props>).props.children)).toContain(ptBR.home.lead);
  });

  it('the not-found page says only "Não encontrado." / "Not found."', async () => {
    const heading = async () => ((((await NotFound()) as ReactElement<Props>).props.children as ReactElement<Props>[])[0])?.props.children;
    expect(await heading()).toBe('Não encontrado.');
    acceptLanguage = 'en';
    expect(await heading()).toBe('Not found.');
  });

  it('keeps both message files in step', () => {
    const keys = (value: unknown, prefix = ''): string[] =>
      typeof value === 'object' && value !== null
        ? Object.entries(value).flatMap(([key, inner]) => keys(inner, `${prefix}${key}.`))
        : [prefix];
    expect(keys(en).sort()).toEqual(keys(ptBR).sort());
    expect(messagesFor('en')).toBe(en);
    expect(languageFor(undefined)).toBe('pt-BR');
  });
});
