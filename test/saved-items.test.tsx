import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Story 3.12: the saved items panel in the shell's right panel slot. Its button and shortcut, Esc and focus, one right
 * panel at a time (both ways), the empty sentence, its pages, "Ir" in the same and in another campaign, the narrow
 * screen's close, and its reload when a bookmark changes.
 */
let pathname = '/questions';
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ refresh: () => undefined, push: () => undefined, prefetch: () => undefined }),
}));

const { ShellFrame, ShellPanel } = await import('@/components/ShellPanel');
const { SavedItemsButton, SavedItemsProvider, useSavedItems } = await import('@/components/saved/SavedItems');
const { SavedItemsPanel, SAVED_PAGE_SIZE } = await import('@/components/saved/SavedItemsPanel');
const ptBR = (await import('@/messages/pt-BR.json')).default;
const en = (await import('@/messages/en.json')).default;
type SavedAnswer = import('@/client/conversation').SavedAnswer;
type LoadSaved = import('@/components/saved/SavedItemsPanel').LoadSaved;
type OpenSavedAction = import('@/components/saved/SavedItemsPanel').OpenSavedAction;

const CURRENT = '0190a0b0-0000-7000-8000-000000000002';
const OTHER = '0190a0b0-0000-7000-8000-000000000040';

function answer(index: number, more: Partial<SavedAnswer> = {}): SavedAnswer {
  const hex = index.toString(16).padStart(4, '0');
  return {
    turnId: `0190a0b0-0000-7000-8000-00000000${hex}`,
    conversationId: `0190a0b0-0000-7000-8000-0000000a${hex}`,
    campaignId: CURRENT,
    campaignName: 'Primeira campanha',
    area: 'questions',
    conversationName: `Magias ${index}`,
    savedAt: '2026-11-22T12:00:00Z',
    excerpt: `Resposta salva número ${index}.`,
    ...more,
  };
}

/** A list of `total` saved answers, the first in the current campaign and the second in another, paged as asked. */
function listOf(total: number): LoadSaved & ReturnType<typeof vi.fn> {
  const all = Array.from({ length: total }, (_, index) =>
    answer(index + 1, index === 1 ? { campaignId: OTHER, campaignName: 'A Coroa Partida', area: 'rules', conversationName: 'Descanso' } : {}),
  );
  return vi.fn(async (offset: number, limit: number) => ({ ok: true as const, items: all.slice(offset, offset + limit), total }));
}

let mediaListeners: (() => void)[] = [];
let width = 1440;
function atWidth(next: number): void {
  width = next;
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return query === '(min-width: 1280px)' ? width >= 1280 : false;
    },
    media: query,
    addEventListener: (_type: string, listener: () => void) => mediaListeners.push(listener),
    removeEventListener: (_type: string, listener: () => void) => {
      mediaListeners = mediaListeners.filter((other) => other !== listener);
    },
  }));
}

/** A page with a field, a source view it can open (as the conversation's) and a control that changes a bookmark. */
function Page() {
  const [source, setSource] = useState(false);
  const saved = useSavedItems();
  return (
    <>
      <label>
        Pergunta
        <input />
      </label>
      <button type="button" onClick={() => setSource(true)}>
        referência
      </button>
      <button type="button" onClick={() => saved?.savedChanged()}>
        marcar
      </button>
      {source ? (
        <ShellPanel onReplaced={() => setSource(false)}>
          <section role="dialog" aria-label="fonte">
            <button type="button" onClick={() => setSource(false)}>
              Fechar a fonte
            </button>
          </section>
        </ShellPanel>
      ) : null}
    </>
  );
}

function frame(load: LoadSaved, options: { language?: 'pt-BR' | 'en'; action?: OpenSavedAction; children?: ReactNode } = {}) {
  const language = options.language ?? 'pt-BR';
  const action: OpenSavedAction = options.action ?? (async (previous) => previous);
  return (
    <SavedItemsProvider currentCampaignId={CURRENT}>
      <ShellFrame>
        <div data-behind-panel="">
          <SavedItemsButton language={language} />
          <main>{options.children ?? <Page />}</main>
        </div>
        <SavedItemsPanel language={language} action={action} load={load} />
      </ShellFrame>
    </SavedItemsProvider>
  );
}

const shell = () => document.querySelector<HTMLElement>('[data-panel]')!;
const panel = () => screen.getByTestId('saved-items');
const button = () => screen.getByRole('button', { name: ptBR.saved.open });
/** The saved answers listed (the pager's arrows are list items too). */
const entries = (language: 'pt-BR' | 'en' = 'pt-BR') =>
  within(within(panel()).getByRole('list', { name: (language === 'en' ? en : ptBR).saved.list })).getAllByRole('listitem');

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  pathname = '/questions';
  mediaListeners = [];
  atWidth(1440);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the saved items panel (Story 3.12)', () => {
  it('its button opens it with focus inside; entries newest first with their meta-line, excerpt and "Ir"; Esc closes it', async () => {
    const user = userEvent.setup();
    const load = listOf(2);
    render(frame(load));
    expect(shell().dataset.panel).toBe('none');
    expect(button().getAttribute('aria-expanded')).toBe('false');

    await user.click(button());

    expect(shell().dataset.panel).toBe('saved');
    expect(within(screen.getByRole('complementary')).getByRole('heading', { name: 'Itens salvos' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: ptBR.saved.close }));
    expect(load).toHaveBeenCalledWith(0, SAVED_PAGE_SIZE);
    await waitFor(() => expect(entries()).toHaveLength(2));
    const [first, second] = entries();
    // The current campaign's: "area › conversation", the excerpt, and a link to its conversation at the answer.
    expect(first!.querySelector('p')!.textContent).toBe('Consultas › Magias 1');
    expect(within(first!).getByText('Resposta salva número 1.')).toBeTruthy();
    const go = within(first!).getByRole('link', { name: 'Ir para a resposta em «Magias 1»' });
    expect(go.textContent).toBe('Ir');
    expect(go.getAttribute('href')).toBe(`/questions/${answer(1).conversationId}?turn=${answer(1).turnId}`);
    // Another campaign's: led by its campaign, and "Ir" switches to it first (a form, not a link).
    expect(second!.querySelector('p')!.textContent).toBe('A Coroa Partida › Criação de Regras › Descanso');
    expect(within(second!).queryByRole('link')).toBeNull();
    expect(within(second!).getByRole('button', { name: 'Ir para a resposta em «Descanso»' }).getAttribute('type')).toBe('submit');
    // Two entries: one page, so no pager.
    expect(within(panel()).queryByRole('navigation')).toBeNull();

    await user.keyboard('{Escape}');

    expect(shell().dataset.panel).toBe('none');
    expect(document.activeElement).toBe(button());
  });

  it('Ctrl+Shift+S and ⌘⇧S open and close it from anywhere, even while a field has focus, and focus goes back there', async () => {
    const user = userEvent.setup();
    render(frame(listOf(1)));
    const field = screen.getByRole('textbox', { name: 'Pergunta' });
    await user.click(field);

    await user.keyboard('{Control>}{Shift>}s{/Shift}{/Control}');
    expect(shell().dataset.panel).toBe('saved');
    expect(panel().contains(document.activeElement)).toBe(true);
    await user.keyboard('{Control>}{Shift>}S{/Shift}{/Control}');
    expect(shell().dataset.panel).toBe('none');
    expect(document.activeElement).toBe(field);

    await user.keyboard('{Meta>}{Shift>}s{/Shift}{/Meta}');
    expect(shell().dataset.panel).toBe('saved');
    // Ctrl+S alone (the browser's save) and Ctrl+Alt+Shift+S are not it.
    await user.keyboard('{Meta>}{Shift>}s{/Shift}{/Meta}');
    await user.keyboard('{Control>}s{/Control}');
    expect(shell().dataset.panel).toBe('none');
    await user.keyboard('{Control>}{Alt>}{Shift>}s{/Shift}{/Alt}{/Control}');
    expect(shell().dataset.panel).toBe('none');
  });

  it('opening it closes the source view (focus goes into it), and opening the source view closes it', async () => {
    const user = userEvent.setup();
    render(frame(listOf(1)));
    await user.click(screen.getByRole('button', { name: 'referência' }));
    expect(shell().dataset.panel).toBe('source');
    await user.click(screen.getByRole('button', { name: 'Fechar a fonte' }));
    await user.click(screen.getByRole('button', { name: 'referência' }));
    screen.getByRole('button', { name: 'Fechar a fonte' }).focus();

    await user.keyboard('{Control>}{Shift>}s{/Shift}{/Control}');

    expect(screen.queryByRole('dialog', { name: 'fonte' })).toBeNull();
    expect(shell().dataset.panel).toBe('saved');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: ptBR.saved.close }));
    expect(screen.getAllByRole('complementary')).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'referência' }));

    expect(screen.queryByTestId('saved-items')).toBeNull();
    expect(shell().dataset.panel).toBe('source');
    expect(screen.getByRole('dialog', { name: 'fonte' })).toBeTruthy();
    expect(button().getAttribute('aria-expanded')).toBe('false');
  });

  it('under 1280px the page behind stays inert as one right panel replaces the other, both ways', async () => {
    const user = userEvent.setup();
    atWidth(1000);
    render(frame(listOf(1)));
    const behind = button().closest('[data-behind-panel]')!;
    fireEvent.click(screen.getByRole('button', { name: 'referência' }));
    expect(shell().dataset.panel).toBe('source');
    expect(behind.hasAttribute('inert')).toBe(true);

    await user.keyboard('{Control>}{Shift>}s{/Shift}{/Control}');

    expect(shell().dataset.panel).toBe('saved');
    expect(screen.queryByRole('dialog', { name: 'fonte' })).toBeNull();
    expect(behind.hasAttribute('inert')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'referência' }));

    expect(shell().dataset.panel).toBe('source');
    expect(screen.queryByTestId('saved-items')).toBeNull();
    expect(behind.hasAttribute('inert')).toBe(true);
  });

  it('a page emptied since (its answers removed elsewhere) gives way to the page before it', async () => {
    const user = userEvent.setup();
    let total = 11;
    const all = Array.from({ length: 11 }, (_, index) => answer(index + 1));
    const load = vi.fn<LoadSaved>(async (offset, limit) => ({ ok: true, items: all.slice(0, total).slice(offset, offset + limit), total }));
    render(frame(load));
    await user.click(button());
    await waitFor(() => expect(entries()).toHaveLength(10));
    await user.click(within(panel()).getByRole('button', { name: ptBR.paging.next }));
    await waitFor(() => expect(entries()).toHaveLength(1));

    total = 10;
    fireEvent.click(screen.getByRole('button', { name: 'marcar' }));

    await waitFor(() => expect(load).toHaveBeenLastCalledWith(0, 10));
    await waitFor(() => expect(entries()).toHaveLength(10));
    expect(load.mock.calls.slice(-2)).toEqual([[10, 10], [0, 10]]);
  });

  it('under 1280px it lies over the page, which is inert while it is open, and "Ir" closes it; at 1280px it stays', async () => {
    const user = userEvent.setup();
    atWidth(1000);
    render(frame(listOf(2)));
    await user.click(button());
    const behind = button().closest('[data-behind-panel]')!;
    expect(behind.hasAttribute('inert')).toBe(true);
    await waitFor(() => expect(entries()).toHaveLength(2));

    fireEvent.click(within(panel()).getByRole('link', { name: /Magias 1/ }));

    expect(screen.queryByTestId('saved-items')).toBeNull();
    expect(behind.hasAttribute('inert')).toBe(false);
    cleanup();

    atWidth(1440);
    render(frame(listOf(2)));
    await user.click(button());
    await waitFor(() => expect(entries()).toHaveLength(2));
    expect(button().closest('[data-behind-panel]')!.hasAttribute('inert')).toBe(false);
    fireEvent.click(within(panel()).getByRole('link', { name: /Magias 1/ }));
    expect(screen.getByTestId('saved-items')).toBeTruthy();
  });

  it('"Ir" to an answer of the conversation open now shows it in place, even at the address an earlier "Ir" opened', async () => {
    // 2026-11-23: a link to the address already open loads nothing again, so the page stayed where it was scrolled (or
    // went to its top) instead of showing the answer.
    const user = userEvent.setup();
    const first = answer(1);
    const turn = <li id={`turn-${first.turnId}`}>Resposta salva número 1.</li>;
    const scrolled: Element[] = [];
    Element.prototype.scrollIntoView = vi.fn(function scrollIntoView(this: Element) {
      scrolled.push(this);
    });
    window.history.replaceState(null, '', `/questions/${first.conversationId}?turn=${first.turnId}`);
    render(frame(listOf(2), { children: <ol>{turn}</ol> }));
    await user.click(button());
    await waitFor(() => expect(entries()).toHaveLength(2));
    for (let time = 0; time < 2; time += 1) {
      fireEvent.click(within(panel()).getByRole('link', { name: /Magias 1/ }));
      expect(scrolled.at(-1)?.id).toBe(`turn-${first.turnId}`);
      expect(document.activeElement?.id).toBe(`turn-${first.turnId}`);
      expect(document.activeElement?.getAttribute('tabindex')).toBe('-1');
      expect(window.location.search).toBe(`?turn=${first.turnId}`);
    }
    expect(scrolled).toHaveLength(2);

    // Another conversation's answer is a plain link: the page it opens shows the answer.
    window.history.replaceState(null, '', '/questions/0190a0b0-0000-7000-8000-0000000affff');
    fireEvent.click(within(panel()).getByRole('link', { name: /Magias 1/ }));
    expect(scrolled).toHaveLength(2);
    window.history.replaceState(null, '', '/');
  });

  it('"Ir" in another campaign sends its form to the Server Action; a refusal shows under it; on a phone it closes on arrival', async () => {
    const user = userEvent.setup();
    atWidth(390);
    const received: Record<string, string>[] = [];
    let refuse = true;
    const action: OpenSavedAction = vi.fn(async (previous, form: FormData) => {
      received.push(Object.fromEntries([...form.entries()].map(([key, value]) => [key, String(value)])));
      // A success redirects in the app; here it answers with no error, and the page that arrives is set below.
      return refuse ? { ...previous, error: 'Não encontrado.' } : { ...previous, error: null };
    });
    const view = render(frame(listOf(2), { action }));
    await user.click(button());
    await waitFor(() => expect(entries()).toHaveLength(2));
    const other = entries()[1]!;

    await user.click(within(other).getByRole('button', { name: /Descanso/ }));

    await waitFor(() => expect(within(other).getByRole('alert').textContent).toBe('Não encontrado.'));
    expect(received).toEqual([{ id: OTHER, conversationId: answer(2).conversationId, area: 'rules', turnId: answer(2).turnId }]);
    // Refused: the page did not change, so the panel stays; nor does a later page it did not lead to close it.
    expect(screen.getByTestId('saved-items')).toBeTruthy();
    pathname = '/systems';
    view.rerender(frame(listOf(2), { action }));
    expect(screen.getByTestId('saved-items')).toBeTruthy();

    refuse = false;
    await user.click(within(other).getByRole('button', { name: /Descanso/ }));
    await settle();
    // The Server Action redirected: the conversation's page arrives, and the panel over it goes.
    pathname = `/rules/${answer(2).conversationId}`;
    view.rerender(frame(listOf(2), { action }));
    expect(screen.queryByTestId('saved-items')).toBeNull();
  });

  it('with nothing saved it says so in one sentence', async () => {
    const user = userEvent.setup();
    render(frame(listOf(0)));
    await user.click(button());
    await waitFor(() => expect(within(panel()).getByText(ptBR.saved.empty)).toBeTruthy());
    expect(within(panel()).queryByRole('list')).toBeNull();
    expect(within(panel()).queryByRole('navigation')).toBeNull();
  });

  it('pages ten at a time with a compact pager at its foot, in its own state (the address never changes)', async () => {
    const user = userEvent.setup();
    const load = listOf(25);
    render(frame(load));
    const address = window.location.href;
    await user.click(button());
    await waitFor(() => expect(entries()).toHaveLength(10));
    const pager = within(panel()).getByRole('navigation', { name: ptBR.saved.pages });
    expect(within(panel()).getByText('1–10 de 25')).toBeTruthy();
    // Compact: the two arrows, no page numbers.
    expect(within(pager).getAllByRole('button')).toHaveLength(2);

    await user.click(within(pager).getByRole('button', { name: ptBR.paging.next }));

    expect(load).toHaveBeenLastCalledWith(10, 10);
    await waitFor(() => expect(within(panel()).getByText('11–20 de 25')).toBeTruthy());
    await user.click(within(panel()).getByRole('button', { name: ptBR.paging.next }));
    await waitFor(() => expect(entries()).toHaveLength(5));
    expect(load).toHaveBeenLastCalledWith(20, 10);
    expect(window.location.href).toBe(address);
  });

  it('reads its list again when a bookmark changes on the page, and says why it could not, with a retry', async () => {
    const user = userEvent.setup();
    const load = listOf(1);
    render(frame(load));
    await user.click(button());
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: 'marcar' }));

    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    cleanup();

    const failing = vi.fn<LoadSaved>(async () => ({ ok: false, problem: { status: 503, category: 'server', code: 'server.unavailable' } }));
    render(frame(failing));
    await user.click(button());
    await waitFor(() => expect(within(panel()).getByRole('alert')).toBeTruthy());
    await user.click(within(panel()).getByRole('button', { name: ptBR.saved.retry }));
    await waitFor(() => expect(failing).toHaveBeenCalledTimes(2));
  });

  it('names its button, title, close control, entries and empty sentence in English too', async () => {
    const user = userEvent.setup();
    render(frame(listOf(2), { language: 'en' }));
    await user.click(screen.getByRole('button', { name: en.saved.open }));
    expect(within(panel()).getByRole('heading', { name: 'Saved items' })).toBeTruthy();
    expect(screen.getByRole('button', { name: en.saved.close })).toBeTruthy();
    await waitFor(() => expect(entries('en')).toHaveLength(2));
    expect(entries('en')[0]!.querySelector('p')!.textContent).toBe('Questions › Magias 1');
    expect(within(panel()).getByRole('link', { name: 'Go to the answer in «Magias 1»' }).textContent).toBe('Go');
    expect(en.saved.empty).toBe('No saved answers. Use the bookmark under an answer to keep it here.');
    expect(ptBR.saved.empty).toBe('Nenhuma resposta salva. Use o marcador sob uma resposta para guardá-la aqui.');
  });
});
