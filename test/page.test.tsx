import { isValidElement, type ReactElement } from 'react';
import { cleanup, render } from '@testing-library/react';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

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
const { default: TermsPage } = await import('@/app/terms/page');
const { default: PrivacyPage } = await import('@/app/privacy/page');
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
    cleanup();
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

  it('signed out: the sign-in screen with "Continuar com Google" and the preferences form, in the chosen language', async () => {
    acceptLanguage = 'en';
    cookieJar = { '__Host-gmshield-theme': 'dark' };
    const view = render(await HomePage());
    expect(view.getByRole('heading', { level: 1 }).textContent).toBe(en.home.heading);
    expect(view.getByText(en.home.lead)).toBeTruthy();
    const google = view.getByRole('button', { name: en.signIn.google });
    expect(google.dataset.variant).toBe('solid');
    expect(view.getAllByRole('button').filter((button) => button.dataset.variant === 'solid')).toHaveLength(1);
    const form = google.closest('form');
    expect(form?.getAttribute('method')).toBe('post');
    expect(form?.getAttribute('action')).toBe('/sign-in/google');
    expect(view.getByRole('link', { name: en.signIn.terms }).getAttribute('href')).toBe('/terms');
    expect(view.getByRole('link', { name: en.signIn.privacy }).getAttribute('href')).toBe('/privacy');
    // Usability pass: the theme and the language are segmented controls at the top of the screen, outside the main part,
    // the current choice pressed; neither is the solid main action.
    expect(view.getByRole('button', { name: en.preferences.themes.dark }).getAttribute('aria-pressed')).toBe('true');
    expect(view.getByRole('button', { name: en.preferences.themes.light }).getAttribute('aria-pressed')).toBe('false');
    expect(view.getByRole('main').contains(view.getByRole('form', { name: en.preferences.title }))).toBe(false);
    expect(view.queryByRole('status')).toBeNull();
    // A page names itself before the product; the sign-in screen is the product's own.
    expect((await generateMetadata()).title).toEqual({ default: en.app.title, template: `%s · ${en.app.title}` });
    cleanup();
    acceptLanguage = null;
    expect(render(await HomePage()).getByRole('button', { name: ptBR.signIn.google })).toBeTruthy();
  });

  it('signed in: / sends the visitor to the shell\'s first page, /questions (Story 1.11)', async () => {
    const calls: string[] = [];
    const backend = createServer((request, response) => {
      calls.push(`${request.method} ${request.url}`);
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ username: 'Mestre_Ana' }));
    });
    await new Promise<void>((resolve) => backend.listen(0, '127.0.0.1', resolve));
    vi.stubEnv('GMSHIELD_MODE', '');
    vi.stubEnv('GMSHIELD_BACKEND_URL', `http://127.0.0.1:${(backend.address() as AddressInfo).port}`);
    vi.stubEnv('GMSHIELD_FRONTEND_CREDENTIAL', 'configured-service-credential-0123456789');
    cookieJar = { '__Host-gmshield-session': 'sessionTokenBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB.9999999999' };
    try {
      await HomePage();
      expect.unreachable('a signed-in visitor is redirected');
    } catch (error) {
      expect(String((error as { digest?: unknown }).digest)).toContain(';/questions;');
    } finally {
      backend.closeAllConnections();
      await new Promise((resolve) => backend.close(resolve));
      vi.unstubAllEnvs();
    }
    expect(calls).toEqual(['GET /api/v1/me']);
  });

  it('shows a known sign-in outcome from the query, and nothing for anything else', async () => {
    const view = render(await HomePage({ searchParams: Promise.resolve({ signIn: 'request.sign_in_expired' }) }));
    expect(view.getByRole('status').textContent).toContain('A tentativa de entrar expirou. Tente de novo.');
    cleanup();
    for (const signIn of ['<script>', 'request.invalid', ['request.sign_in_expired'], undefined]) {
      const other = render(await HomePage({ searchParams: Promise.resolve({ signIn }) }));
      expect(other.queryByRole('status'), String(signIn)).toBeNull();
      cleanup();
    }
  });

  it('the draft terms and privacy notice are marked "Rascunho / Draft" and say what is stored', async () => {
    const terms = render(await TermsPage());
    expect(terms.getByText('Rascunho / Draft')).toBeTruthy();
    expect(terms.getByRole('heading', { level: 1 }).textContent).toBe(ptBR.legal.terms.title);
    cleanup();
    acceptLanguage = 'en';
    const privacy = render(await PrivacyPage());
    expect(privacy.getByText('Rascunho / Draft')).toBeTruthy();
    expect(privacy.getByRole('heading', { level: 1 }).textContent).toBe(en.legal.privacy.title);
    const text = privacy.container.textContent ?? '';
    for (const fact of ['personal data', 'username', 'email address', 'Google account', 'encrypted', 'accepted the terms of use',
      'which version', 'Google learns', 'Azure OpenAI', 'LGPD', 'delete the account', 'how long data is kept']) {
      expect(text).toContain(fact);
    }
  });

  it('the not-found page says only "Não encontrado." / "Not found."', async () => {
    // Usability pass: a card with the title and the one way on; still nothing about whether the item exists.
    const page = async () => {
      const view = render(await NotFound());
      const said = { heading: view.getByRole('heading', { level: 1 }).textContent, text: view.getByRole('main').textContent, home: view.getByRole('link').getAttribute('href') };
      cleanup();
      return said;
    };
    expect(await page()).toEqual({ heading: 'Não encontrado.', text: 'Não encontrado.Ir para o início', home: '/' });
    acceptLanguage = 'en';
    expect((await page()).heading).toBe('Not found.');
  });

  it('keeps both message files in step', () => {
    const keys = (value: unknown, prefix = ''): string[] =>
      typeof value === 'object' && value !== null
        ? Object.entries(value).flatMap(([key, inner]) => keys(inner, `${prefix}${key}.`))
        : [prefix];
    expect(keys(en).sort()).toEqual(keys(ptBR).sort());
    // Story 1.11: the shell's and the placeholders' strings exist in both languages.
    expect(keys(ptBR)).toEqual(expect.arrayContaining(['shell.openMenu.', 'shell.closeMenu.', 'placeholder.files.']));
    // Story 1.14: the dialog's, the tray's and the states' strings exist in both languages.
    expect(keys(ptBR)).toEqual(
      expect.arrayContaining(['upload.dialog.step.', 'upload.tray.interrupted.', 'upload.tray.resume.', 'material.state.needs_review.']),
    );
    expect(ptBR.material.state).toMatchObject({
      uploading: 'enviando',
      waiting: 'aguardando',
      processing: 'processando',
      needs_review: 'precisa de revisão',
      ready: 'pronto',
      failed: 'falhou',
    });
    expect(ptBR.upload.tray.interrupted).toBe('Envio interrompido.');
    expect(ptBR.upload.tray.resume).toBe('Retomar');
    for (const messages of [ptBR, en]) {
      const shown = JSON.stringify(messages.shell) + JSON.stringify(messages.placeholder) + JSON.stringify(messages.upload) + JSON.stringify(messages.material);
      expect(shown).not.toMatch(/!|\p{Extended_Pictographic}/u);
    }
    expect(messagesFor('en')).toBe(en);
    expect(languageFor(undefined)).toBe('pt-BR');
  });
});
