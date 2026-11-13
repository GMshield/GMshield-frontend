import { isValidElement, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

let acceptLanguage: string | null = null;
vi.mock('next/headers', () => ({
  headers: async () => new Headers(acceptLanguage === null ? {} : { 'accept-language': acceptLanguage }),
}));

const { default: RootLayout, generateMetadata } = await import('@/app/layout');
const { default: HomePage } = await import('@/app/page');
const { languageFor, messagesFor } = await import('@/messages');
const ptBR = (await import('@/messages/pt-BR.json')).default;
const en = (await import('@/messages/en.json')).default;

type Props = { lang?: string; children?: unknown };

describe('page (GET /)', () => {
  afterEach(() => {
    acceptLanguage = null;
  });

  it('sets <html lang> from the language, Portuguese by default', async () => {
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
      const html = (await RootLayout({ children: null })) as ReactElement<Props>;
      expect(isValidElement(html)).toBe(true);
      expect(html.type).toBe('html');
      expect(html.props.lang, String(header)).toBe(lang);
    }
  });

  it('shows the scaffold text in the chosen language', async () => {
    acceptLanguage = 'en';
    const page = (await HomePage()) as ReactElement<Props>;
    expect(JSON.stringify(page.props.children)).toContain(en.home.lead);
    expect((await generateMetadata()).title).toBe(en.app.title);
    acceptLanguage = null;
    expect(JSON.stringify(((await HomePage()) as ReactElement<Props>).props.children)).toContain(ptBR.home.lead);
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
