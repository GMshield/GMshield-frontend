import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useRef, type ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

let pathname = '/questions';
const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ refresh }),
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
}));
vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => undefined }),
}));

// Story 1.14: the browser upload module, reduced to what the shell hands it.
type StartUpload = (file: File, options: { metadata?: Record<string, string> }) => { done: Promise<never>; abort: () => Promise<void> };
const startUpload = vi.fn<StartUpload>(() => ({ done: new Promise<never>(() => undefined), abort: async () => undefined }));
vi.mock('@/client/upload', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/client/upload')>()), startUpload }));

const { Shell } = await import('@/components/Shell');
const { SIDEBAR_ENTRIES } = await import('@/components/shell-entries');
const { ShellPanel } = await import('@/components/ShellPanel');
const ptBR = (await import('@/messages/pt-BR.json')).default;
const en = (await import('@/messages/en.json')).default;

type Language = 'pt-BR' | 'en';
const CURRENT = { system: 'Untitled system', campaign: 'First campaign' };
const COOKIE_CLOSED = '__Host-gmshield-sidebar=closed; Path=/; Max-Age=31536000; Secure; SameSite=Lax';
const COOKIE_OPEN = '__Host-gmshield-sidebar=open; Path=/; Max-Age=31536000; Secure; SameSite=Lax';

let mediaListeners: (() => void)[] = [];
let currentWidth = 1440;

/** The width the page is at: CSS decides the layout, the sidebar asks only whether it is 1280px or more. */
function atWidth(width: number): void {
  currentWidth = width;
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return query === '(min-width: 1280px)' ? currentWidth >= 1280 : false;
    },
    media: query,
    addEventListener: (_type: string, listener: () => void) => mediaListeners.push(listener),
    removeEventListener: (_type: string, listener: () => void) => {
      mediaListeners = mediaListeners.filter((other) => other !== listener);
    },
  }));
}

/** The window is resized: the media queries' listeners hear of it. */
function resizeTo(width: number): void {
  currentWidth = width;
  act(() => {
    for (const listener of [...mediaListeners]) {
      listener();
    }
  });
}

function shell(options: { language?: Language; sidebar?: 'open' | 'closed'; current?: typeof CURRENT | null; children?: ReactNode } = {}) {
  const language = options.language ?? 'pt-BR';
  return (
    <Shell
      preferences={{ theme: 'dark', language }}
      username="Mestre_Ana"
      current={options.current === undefined ? CURRENT : options.current}
      sidebar={options.sidebar ?? 'open'}
    >
      {options.children ?? <h1>Página</h1>}
    </Shell>
  );
}

let cookieLines: string[] = [];

beforeEach(() => {
  mediaListeners = [];
  pathname = '/questions';
  cookieLines = [];
  vi.spyOn(document, 'cookie', 'set').mockImplementation((line: string) => {
    cookieLines.push(line);
  });
  atWidth(1440);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const area = () => screen.getByTestId('sidebar').parentElement!;

describe('the signed-in shell (Story 1.11)', () => {
  it('lists the logo, the current campaign, the six entries in order and "Adicionar Arquivo" last', () => {
    const { container } = render(shell());
    const sidebar = screen.getByTestId('sidebar');
    const nav = within(sidebar).getByRole('navigation', { name: ptBR.shell.navigation });
    const links = within(nav).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual(['Consultas', 'Criação de Regras', 'Minhas Mesas', 'Sistemas', 'Personagens', 'Meus Arquivos']);
    expect(links.map((link) => link.getAttribute('href'))).toEqual(SIDEBAR_ENTRIES.map((entry) => entry.href));
    // Story 1.14: "Adicionar Arquivo" opens the guided upload; it is no longer a page.
    expect(within(sidebar).queryByRole('link', { name: 'Adicionar Arquivo' })).toBeNull();
    const add = within(sidebar).getByRole('button', { name: 'Adicionar Arquivo' });
    expect(add.getAttribute('aria-haspopup')).toBe('dialog');
    expect(add.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(nav.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The logo and name come first, then the current campaign.
    const logo = within(sidebar).getByRole('button', { name: 'GMshield' });
    expect(logo.compareDocumentPosition(nav) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(sidebar).getByText('First campaign')).toBeTruthy();
    expect(within(sidebar).getByText(ptBR.shell.currentCampaign)).toBeTruthy();
    expect(container.querySelectorAll('[style]')).toHaveLength(0);
  });

  it('marks the current entry, and only it', () => {
    pathname = '/systems';
    render(shell());
    const current = screen.getAllByRole('link').filter((link) => link.getAttribute('aria-current') === 'page');
    expect(current.map((link) => link.textContent)).toEqual(['Sistemas']);
  });

  it('puts the sidebar, the context bar and the main column in that order, in the page and in Tab order', async () => {
    const user = userEvent.setup();
    render(shell({ children: <a href="/questions#start">início</a> }));
    const sidebar = screen.getByTestId('sidebar');
    const context = screen.getByRole('navigation', { name: ptBR.shell.context });
    const main = screen.getByRole('main');
    expect(sidebar.compareDocumentPosition(context) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(context.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(context.textContent).toBe('Untitled system›First campaign');

    // Tab from the top of the page until focus leaves the last control: every stop, by region.
    const visited: string[] = [];
    for (let i = 0; i < 40; i++) {
      await user.tab();
      const focused = document.activeElement;
      if (focused === null || focused === document.body) {
        break;
      }
      visited.push(area().contains(focused) ? 'sidebar' : context.contains(focused) ? 'context' : main.contains(focused) ? 'main' : 'other');
    }
    const regions = visited.filter((place, index) => index === 0 || visited[index - 1] !== place);
    expect(regions).toEqual(['sidebar', 'context', 'main']);
    expect(visited.filter((place) => place === 'sidebar').length).toBeGreaterThanOrEqual(9);
  });

  it('at 1280px and more, Ctrl+B closes the sidebar to "Abrir menu" and the cookie remembers it; ⌘B opens it again', async () => {
    const user = userEvent.setup();
    render(shell());
    expect(area().dataset.wide).toBe('open');

    await user.keyboard('{Control>}b{/Control}');
    expect(area().dataset.wide).toBe('closed');
    expect(cookieLines).toEqual([COOKIE_CLOSED]);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Abrir menu' }));

    await user.keyboard('{Meta>}b{/Meta}');
    expect(area().dataset.wide).toBe('open');
    expect(cookieLines).toEqual([COOKIE_CLOSED, COOKIE_OPEN]);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Fechar menu' }));
    // Ctrl+Shift+B is another shortcut (none yet), not this one.
    await user.keyboard('{Control>}{Shift>}b{/Shift}{/Control}');
    expect(area().dataset.wide).toBe('open');
  });

  it('starts closed when the cookie says so, and the collapse control and the handle toggle it', async () => {
    const user = userEvent.setup();
    render(shell({ sidebar: 'closed' }));
    expect(area().dataset.wide).toBe('closed');
    await user.click(screen.getByRole('button', { name: 'Abrir menu' }));
    expect(area().dataset.wide).toBe('open');
    expect(cookieLines).toEqual([COOKIE_OPEN]);
    await user.click(screen.getByRole('button', { name: 'Fechar menu' }));
    expect(area().dataset.wide).toBe('closed');
  });

  it('under 1280px it starts closed whatever the cookie, the handle opens it, and choosing an entry closes it', async () => {
    const user = userEvent.setup();
    atWidth(1000);
    const view = render(shell({ sidebar: 'open' }));
    expect(area().dataset.narrow).toBe('closed');

    await user.click(screen.getByRole('button', { name: 'Abrir menu' }));
    expect(area().dataset.narrow).toBe('open');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Fechar menu' }));
    // The narrow state is never remembered.
    expect(cookieLines).toEqual([]);

    // A choice: the link closes the sheet, and the new page (another path) finds it closed.
    await user.click(screen.getByRole('link', { name: 'Personagens' }));
    pathname = '/characters';
    view.rerender(shell({ sidebar: 'open' }));
    expect(area().dataset.narrow).toBe('closed');

    // Opened again, it also closes when the path changes some other way, and on Esc.
    await user.click(screen.getByRole('button', { name: 'Abrir menu' }));
    expect(area().dataset.narrow).toBe('open');
    pathname = '/files';
    view.rerender(shell({ sidebar: 'open' }));
    expect(area().dataset.narrow).toBe('closed');
    await user.click(screen.getByRole('button', { name: 'Abrir menu' }));
    await user.keyboard('{Escape}');
    expect(area().dataset.narrow).toBe('closed');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Abrir menu' }));
  });

  it('under 1280px the open sidebar makes the page behind it inert until it closes', async () => {
    const user = userEvent.setup();
    atWidth(1000);
    render(
      <Shell preferences={{ theme: 'dark', language: 'pt-BR' }} username="u" current={CURRENT} sidebar="open" panel={<a href="/x">painel</a>}>
        <a href="/questions#start">início</a>
      </Shell>,
    );
    const context = screen.getByRole('navigation', { name: ptBR.shell.context });
    const column = context.parentElement!;
    const panel = screen.getByRole('complementary');
    expect(column.hasAttribute('inert')).toBe(false);
    expect(panel.hasAttribute('inert')).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Abrir menu' }));
    expect(column.hasAttribute('inert')).toBe(true);
    expect(panel.hasAttribute('inert')).toBe(true);
    expect(column.contains(screen.getByRole('link', { name: 'início', hidden: true }))).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Fechar menu' }));
    expect(column.hasAttribute('inert')).toBe(false);
    expect(panel.hasAttribute('inert')).toBe(false);

    // Widened to 1280px while open over the page: the narrow state ends and the page is no longer inert.
    await user.click(screen.getByRole('button', { name: 'Abrir menu' }));
    expect(column.hasAttribute('inert')).toBe(true);
    resizeTo(1440);
    expect(area().dataset.narrow).toBe('closed');
    expect(column.hasAttribute('inert')).toBe(false);
  });

  it('at 1280px and more the page beside the sidebar is never inert', async () => {
    const user = userEvent.setup();
    render(shell());
    const column = screen.getByRole('navigation', { name: ptBR.shell.context }).parentElement!;
    await user.keyboard('{Control>}b{/Control}');
    await user.keyboard('{Control>}b{/Control}');
    expect(column.hasAttribute('inert')).toBe(false);
  });

  it('under 768px the sheet works the same way (CSS makes it full-screen)', async () => {
    const user = userEvent.setup();
    atWidth(600);
    const view = render(shell({ sidebar: 'closed' }));
    await user.keyboard('{Control>}b{/Control}');
    expect(area().dataset.narrow).toBe('open');
    expect(area().dataset.wide).toBe('closed');
    expect(screen.getByRole('main', { hidden: true }).parentElement!.hasAttribute('inert')).toBe(true);
    await user.click(screen.getByRole('link', { name: 'Meus Arquivos' }));
    pathname = '/files';
    view.rerender(shell({ sidebar: 'closed' }));
    expect(area().dataset.narrow).toBe('closed');
    expect(screen.getByRole('main').parentElement!.hasAttribute('inert')).toBe(false);
    expect(cookieLines).toEqual([]);
  });

  it('names every icon-only control and landmark in both languages', () => {
    for (const [language, messages] of [['pt-BR', ptBR], ['en', en]] as const) {
      render(shell({ language }));
      for (const name of [messages.shell.openMenu, messages.shell.closeMenu]) {
        const button = screen.getByRole('button', { name });
        expect(button.getAttribute('aria-label')).toBe(name);
        expect(button.textContent).toBe('');
      }
      expect(screen.getByRole('navigation', { name: messages.shell.navigation })).toBeTruthy();
      expect(screen.getByRole('navigation', { name: messages.shell.context })).toBeTruthy();
      for (const key of ['questions', 'rules', 'campaigns', 'systems', 'characters', 'files'] as const) {
        expect(screen.getByRole('link', { name: messages.shell.entries[key] })).toBeTruthy();
      }
      expect(screen.getByRole('button', { name: messages.shell.entries.addFile })).toBeTruthy();
      cleanup();
    }
    expect(en.shell.openMenu).toBe('Open menu');
    expect(ptBR.shell.openMenu).toBe('Abrir menu');
  });

  it('the logo menu holds the preferences and "Sair"; Esc closes it and gives focus back to the logo', async () => {
    const user = userEvent.setup();
    render(shell());
    const logo = screen.getByRole('button', { name: 'GMshield' });
    expect(logo.getAttribute('aria-expanded')).toBe('false');
    const menu = document.getElementById(logo.getAttribute('aria-controls')!)!;
    expect(menu.hidden).toBe(true);

    await user.click(logo);
    expect(logo.getAttribute('aria-expanded')).toBe('true');
    expect(menu.hidden).toBe(false);
    const group = screen.getByRole('group', { name: ptBR.shell.menu });
    expect(within(group).getByRole('button', { name: 'Sair' })).toBeTruthy();
    expect(within(group).getByRole('radio', { name: ptBR.preferences.themes.dark })).toBeTruthy();
    expect(within(group).getByText('Conectado como Mestre_Ana')).toBeTruthy();
    // No Account or Administration entry yet.
    expect(within(group).queryByRole('link')).toBeNull();

    await user.click(within(group).getByRole('radio', { name: ptBR.preferences.themes.light }));
    await user.keyboard('{Escape}');
    expect(menu.hidden).toBe(true);
    expect(document.activeElement).toBe(logo);
    // Esc in the menu is the menu's: the sidebar stays as it was.
    expect(area().dataset.wide).toBe('open');
  });

  it('under 1280px, Esc in the open logo menu closes the menu only; the next Esc closes the sidebar', async () => {
    const user = userEvent.setup();
    atWidth(1000);
    render(shell());
    await user.click(screen.getByRole('button', { name: 'Abrir menu' }));
    expect(area().dataset.narrow).toBe('open');
    const logo = screen.getByRole('button', { name: 'GMshield' });
    await user.click(logo);
    expect(logo.getAttribute('aria-expanded')).toBe('true');

    await user.keyboard('{Escape}');
    expect(logo.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(logo);
    expect(area().dataset.narrow).toBe('open');

    await user.keyboard('{Escape}');
    expect(area().dataset.narrow).toBe('closed');
  });

  it('the context bar reads "system › campaign", or says there is no campaign', () => {
    render(shell({ language: 'en' }));
    const context = screen.getByRole('navigation', { name: en.shell.context });
    expect(within(context).getByRole('link', { name: 'Untitled system' }).getAttribute('href')).toBe('/systems');
    expect(within(context).getByRole('link', { name: 'First campaign' }).getAttribute('href')).toBe('/campaigns');
    cleanup();
    render(shell({ current: null }));
    expect(screen.getByRole('navigation', { name: ptBR.shell.context }).textContent).toBe(ptBR.shell.noCampaign);
    expect(screen.getByTestId('sidebar').textContent).toContain(ptBR.shell.noCampaign);
  });

  it('renders the page in the main column, and a right panel only when there is one', () => {
    render(shell({ children: <p>conteúdo</p> }));
    expect(within(screen.getByRole('main')).getByText('conteúdo')).toBeTruthy();
    expect(screen.queryByRole('complementary')).toBeNull();
    cleanup();
    render(
      <Shell preferences={{ theme: 'light', language: 'en' }} username="u" current={CURRENT} sidebar="open" panel={<p>panel</p>}>
        <p>x</p>
      </Shell>,
    );
    expect(within(screen.getByRole('complementary')).getByText('panel')).toBeTruthy();
    act(() => undefined);
  });
});

describe('the source view in the shell\'s panel slot (Story 2.7)', () => {
  /** A page whose source view is open or not: it fills the slot from the main column through `ShellPanel`. */
  function page(open: boolean, sidebar: 'open' | 'closed' = 'open') {
    return shell({
      sidebar,
      children: (
        <>
          <button type="button">referência</button>
          {open ? (
            <ShellPanel>
              <section role="dialog" aria-label="fonte">
                <button type="button">Fechar a fonte</button>
              </section>
            </ShellPanel>
          ) : null}
        </>
      ),
    });
  }
  const frame = () => area().parentElement!;
  const column = () => screen.getByRole('navigation', { name: ptBR.shell.context }).parentElement!;

  it('at 1280px and more takes the 560px column beside the main one, and nothing is inert', () => {
    const view = render(page(false));
    expect(frame().dataset.panel).toBe('none');
    expect(screen.queryByRole('complementary')).toBeNull();

    view.rerender(page(true));

    expect(frame().dataset.panel).toBe('source');
    const panel = screen.getByRole('complementary');
    expect(within(panel).getByRole('dialog', { name: 'fonte' })).toBeTruthy();
    expect(within(screen.getByRole('main')).queryByRole('dialog')).toBeNull();
    expect(column().hasAttribute('inert')).toBe(false);
    expect(panel.hasAttribute('inert')).toBe(false);

    view.rerender(page(false));
    expect(frame().dataset.panel).toBe('none');
    expect(screen.queryByRole('complementary')).toBeNull();
  });

  it('under 1280px opens over the main column, which is inert until it closes, and focus can go back to it at once', () => {
    atWidth(1000);
    const view = render(page(true, 'closed'));
    expect(frame().dataset.panel).toBe('source');
    expect(column().hasAttribute('inert')).toBe(true);
    expect(screen.getByRole('complementary').hasAttribute('inert')).toBe(false);

    view.rerender(page(false, 'closed'));
    expect(column().hasAttribute('inert')).toBe(false);
    const reference = screen.getByRole('button', { name: 'referência' });
    reference.focus();
    expect(document.activeElement).toBe(reference);

    // Widened to 1280px while open: the main column narrows instead and is no longer inert.
    view.rerender(page(true, 'closed'));
    expect(column().hasAttribute('inert')).toBe(true);
    resizeTo(1440);
    expect(column().hasAttribute('inert')).toBe(false);
  });

  it('under 1280px, on close, a parent effect already sees the main column without inert, so it can give focus back', () => {
    atWidth(1000);
    const seen: boolean[] = [];
    /** As the conversation does: on close, its effect gives focus back to the reference behind the panel. */
    function Closer({ open }: { readonly open: boolean }) {
      const reference = useRef<HTMLButtonElement>(null);
      const wasOpen = useRef(false);
      useEffect(() => {
        if (!open && wasOpen.current) {
          seen.push(reference.current!.closest('[inert]') === null);
          reference.current!.focus();
        }
        wasOpen.current = open;
      }, [open]);
      return (
        <>
          <button ref={reference} type="button">
            referência
          </button>
          {open ? (
            <ShellPanel>
              <section role="dialog" aria-label="fonte">
                <button type="button">Fechar a fonte</button>
              </section>
            </ShellPanel>
          ) : null}
        </>
      );
    }
    const view = render(shell({ sidebar: 'closed', children: <Closer open /> }));
    expect(column().hasAttribute('inert')).toBe(true);

    view.rerender(shell({ sidebar: 'closed', children: <Closer open={false} /> }));

    expect(seen).toEqual([true]);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'referência' }));
  });

  it('under 768px is the same, and the sidebar opened over it leaves the main column inert for the panel once it closes', async () => {
    const user = userEvent.setup();
    atWidth(600);
    render(page(true, 'closed'));
    expect(column().hasAttribute('inert')).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Abrir menu' }));
    expect(column().hasAttribute('inert')).toBe(true);
    expect(screen.getByRole('complementary', { hidden: true }).hasAttribute('inert')).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Fechar menu' }));

    expect(column().hasAttribute('inert')).toBe(true);
    expect(screen.getByRole('complementary').hasAttribute('inert')).toBe(false);
  });

  it('sizes the slot in CSS: 560px, over the main column under 1280px, a full-screen sheet under 768px', () => {
    const css = readFileSync(join(process.cwd(), 'src/components/Shell.module.css'), 'utf8');
    expect(css).toMatch(/\.shell\[data-panel='source'\] \.panel \{\s*width: var\(--width-source-view\);/);
    expect(css).toMatch(/@media \(max-width: 1279px\) \{\s*\/\*[^*]*\*\/\s*\.shell\[data-panel='source'\] \.panel \{\s*position: fixed;/);
    expect(css).toMatch(/@media \(max-width: 767px\) \{\s*\/\*[^*]*\*\/\s*\.shell\[data-panel='source'\] \.panel \{\s*left: 0;\s*width: 100%;/);
  });
});

describe('the shell hands the guided upload its campaign and system (Story 1.14)', () => {
  // jsdom has no modal dialogs: the smallest stand-in for showModal() and close().
  beforeAll(() => {
    if (typeof HTMLDialogElement.prototype.showModal !== 'function') {
      HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
        this.setAttribute('open', '');
      };
      HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
        this.removeAttribute('open');
      };
    }
  });
  const BELONGING = {
    campaign: { id: '0190a0b0-0000-7000-8000-000000000002', name: 'First campaign' },
    system: { id: '0190a0b0-0000-7000-8000-000000000001', name: 'Untitled system' },
  };

  for (const [choice, expected] of [
    [/Só em First campaign/, { campaign: BELONGING.campaign.id }],
    [/Em todas as campanhas de Untitled system/, { system: BELONGING.system.id }],
  ] as const) {
    it(`sends ${Object.keys(expected)[0]}'s id for that choice`, async () => {
      startUpload.mockClear();
      const user = userEvent.setup();
      render(
        <Shell preferences={{ theme: 'dark', language: 'pt-BR' }} username="Mestre_Ana" current={CURRENT} sidebar="open" belonging={BELONGING}>
          <h1>Página</h1>
        </Shell>,
      );
      await user.click(screen.getByRole('button', { name: 'Adicionar Arquivo' }));
      const modal = screen.getByRole('dialog', { hidden: true });
      const bytes = new Uint8Array(6000);
      bytes.set(new TextEncoder().encode('%PDF-1.7\n'));
      fireEvent.change(within(modal).getByTestId('upload-files'), { target: { files: [new File([bytes], 'Livro.pdf')] } });
      await within(modal).findByText(/Pronto para enviar/);
      await user.click(within(modal).getByRole('button', { name: 'Próximo' }));
      await user.click(within(modal).getByRole('button', { name: 'Próximo' }));
      await user.click(within(modal).getByRole('radio', { name: choice }));
      await user.click(within(modal).getByRole('button', { name: 'Próximo' }));
      await user.click(within(modal).getByRole('button', { name: 'Enviar' }));
      expect(startUpload).toHaveBeenCalledOnce();
      expect(startUpload.mock.calls[0]![1].metadata).toEqual({ kind: 'rulebook', language: 'detect', ...expected });
    });
  }
});
