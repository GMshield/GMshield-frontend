import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import type { UrlStorage } from 'tus-js-client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { NO_PLACES } from '@/components/uploads/types';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => undefined }), usePathname: () => '/questions' }));

type Ask = (campaignId: string, question: string) => Promise<unknown>;
const postQuestion = vi.fn<Ask>();
const stopTurn = vi.fn<(turnId: string) => Promise<boolean>>();
type SetDismissal = typeof import('@/client/conversation').setDismissal;
const setDismissal = vi.fn<SetDismissal>();
type SetBookmark = typeof import('@/client/conversation').setBookmark;
const setBookmark = vi.fn<SetBookmark>();
vi.mock('@/client/conversation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/client/conversation')>()),
  postQuestion,
  stopTurn,
  setDismissal,
  setBookmark,
}));

const { Conversation, DRAFT_PREFIX, RECONNECT_GIVE_UP_MS, UNDO_MS } = await import('@/components/conversation/Conversation');
const { UploadsProvider, useUploads } = await import('@/components/uploads/UploadsProvider');
const { uploadTexts } = await import('@/components/uploads/upload-texts');
const { errorText } = await import('@/messages');
const { ScopePopover } = await import('@/components/ScopePopover');
const { ScopePopoverProvider } = await import('@/components/ScopePopoverContext');

const CAMPAIGN = '0190a0b0-0000-7000-8000-000000000002';
const TURN = '0190a0b0-0000-7000-8000-000000000021';
const PASSAGE_A = '0190a0b0-0000-7000-8000-000000000009';
const PASSAGE_B = '0190a0b0-0000-7000-8000-00000000000b';
const PASSAGE_C = '0190a0b0-0000-7000-8000-00000000000c';

/** A source reference as the done event carries it (Story 2.5). */
function reference(number: number, passageIds: string[], more: Record<string, unknown> = {}) {
  return { number, kind: 'passage' as const, materialName: 'Livro do Jogador.pdf', sectionPath: ['Magias', 'Fire Bolt'], page: 3, passageIds, removed: false, ...more };
}

/** A done event with one reference of `passageIds`. */
function doneWith(...passageIds: string[]) {
  return { silent: false, references: [reference(1, passageIds)] };
}

/** A stream the test writes events into, as the backend would. */
class FakeStream extends EventTarget {
  readyState = 1;
  closed = false;
  constructor(readonly url: string) {
    super();
  }
  close(): void {
    this.closed = true;
    this.readyState = 2;
  }
  /** An event of the backend, with its sequence when `id` is given (Story 2.6). */
  emit(name: string, data: unknown, id?: number): void {
    act(() => {
      this.dispatchEvent(new MessageEvent(name, { data: JSON.stringify(data), lastEventId: id === undefined ? '' : String(id) }));
    });
  }
  /** The connection is (re)established. */
  open(): void {
    act(() => {
      this.dispatchEvent(new Event('open'));
    });
  }
  /** The connection drops: the browser reconnects, or with `givenUp` it has given up (`CLOSED`). */
  drop(givenUp = false): void {
    if (givenUp) {
      this.readyState = 2;
    }
    act(() => {
      this.dispatchEvent(new Event('error'));
    });
  }
}

let streams: FakeStream[] = [];

function memoryStorage(): UrlStorage {
  return {
    findAllUploads: async () => [],
    findUploadsByFingerprint: async () => [],
    removeUpload: async () => undefined,
    addUpload: async () => 'key',
  };
}

function UploadState() {
  return <p data-testid="upload-state">{useUploads().uploadOpen ? 'open' : 'closed'}</p>;
}

type LoadPage = (turnId: string, number: number, page: number, signal: AbortSignal) => Promise<unknown>;

function view(
  options: {
    language?: 'pt-BR' | 'en';
    hasSources?: boolean;
    review?: { href: string; name: string } | null;
    loadPage?: LoadPage;
    recordTypes?: readonly { key: string; name: string }[];
  } = {},
) {
  return render(
    <UploadsProvider texts={uploadTexts(options.language ?? 'pt-BR')} belonging={NO_PLACES} urlStorage={memoryStorage()}>
      <Conversation
        language={options.language ?? 'pt-BR'}
        campaignId={CAMPAIGN}
        hasSources={options.hasSources ?? true}
        review={options.review ?? null}
        openStream={(url) => {
          const stream = new FakeStream(url);
          streams.push(stream);
          return stream as unknown as EventSource;
        }}
        loadPage={options.loadPage as never}
        recordTypes={options.recordTypes}
      />
      <UploadState />
    </UploadsProvider>,
  );
}

function composer(): HTMLTextAreaElement {
  return screen.getByRole('textbox') as HTMLTextAreaElement;
}

/** The turns as the screen shows them (the live region repeats some of their words): the first list on the page. */
function turns() {
  return within(screen.getAllByRole('list')[0]!);
}

/** A superscript's visible number (its last text; a visually hidden word comes before it). */
function shown(sup: Node): string {
  return sup.lastChild?.textContent ?? '';
}

/** The numbers of the superscripts on the screen, in order. */
function superscripts(): string[] {
  return [...screen.getAllByRole('list')[0]!.querySelectorAll('sup')].map(shown);
}

function polite(): string {
  return screen.getByTestId('conversation-polite').textContent ?? '';
}

/** What the assertive region says (Story 2.6), its alternating zero-width space dropped. */
function alerted(): string {
  return (screen.getByTestId('conversation-alert').textContent ?? '').replaceAll('\u200b', '');
}

/** Asks `question` with Enter; the turn the backend records is in `language`. */
async function ask(question: string, language: string | null = 'pt-BR'): Promise<FakeStream> {
  postQuestion.mockResolvedValueOnce({ ok: true, turn: { id: TURN, conversationId: 'c', language } });
  const user = userEvent.setup();
  await user.type(composer(), question);
  await user.keyboard('{Enter}');
  await waitFor(() => expect(streams).toHaveLength(1));
  return streams[0]!;
}

describe('the conversation (Story 2.4)', () => {
  beforeEach(() => {
    streams = [];
    postQuestion.mockReset();
    stopTurn.mockReset();
    stopTurn.mockResolvedValue(true);
    localStorage.clear();
  });
  afterEach(() => {
    cleanup();
  });

  it('Enter sends, Shift+Enter adds a line, and the composer grows to six lines', async () => {
    view();
    const user = userEvent.setup();
    await user.type(composer(), 'Uma{Shift>}{Enter}{/Shift}duas');
    expect(composer().value).toBe('Uma\nduas');
    expect(composer().rows).toBe(2);
    await user.type(composer(), '{Shift>}{Enter}{Enter}{Enter}{Enter}{Enter}{Enter}{/Shift}');
    expect(composer().rows).toBe(6);
    expect(postQuestion).not.toHaveBeenCalled();

    postQuestion.mockResolvedValueOnce({ ok: true, turn: { id: TURN, conversationId: 'c', language: 'pt-BR' } });
    await user.keyboard('{Enter}');

    expect(postQuestion).toHaveBeenCalledWith(CAMPAIGN, 'Uma\nduas\n\n\n\n\n\n', { area: 'questions' });
    expect(composer().value).toBe('');
    expect(composer().rows).toBe(1);
    await waitFor(() => expect(streams).toHaveLength(1));
    streams[0]!.emit('done', { stopped: false, silent: true, references: [] });
    // A blank question is never sent.
    await user.type(composer(), '   {Enter}');
    expect(postQuestion).toHaveBeenCalledTimes(1);
    // The send control is a button spoken "Enviar".
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeTruthy();
  });

  it('keeps the draft per campaign and conversation in this browser and clears it on send', async () => {
    localStorage.setItem(`${DRAFT_PREFIX}${CAMPAIGN}:new:questions`, 'Rascunho guardado');
    view();
    await waitFor(() => expect(composer().value).toBe('Rascunho guardado'));
    const user = userEvent.setup();
    await user.type(composer(), '?');
    expect(localStorage.getItem(`${DRAFT_PREFIX}${CAMPAIGN}:new:questions`)).toBe('Rascunho guardado?');

    postQuestion.mockResolvedValueOnce({ ok: true, turn: { id: TURN, conversationId: 'c', language: 'pt-BR' } });
    await user.click(screen.getByRole('button', { name: 'Enviar' }));

    expect(localStorage.getItem(`${DRAFT_PREFIX}${CAMPAIGN}:new:questions`)).toBeNull();
  });

  it('works when the browser keeps nothing', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    try {
      view();
      await userEvent.setup().type(composer(), 'Pergunta');
      expect(composer().value).toBe('Pergunta');
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
    }
  });

  it('shows the question at once, muted, with the waiting line and no spinner, then the answer as it streams', async () => {
    view();
    let answer: (value: unknown) => void = () => undefined;
    postQuestion.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    const user = userEvent.setup();
    await user.type(composer(), 'Quanto dano causa Fire Bolt?{Enter}');

    const question = screen.getByText('Quanto dano causa Fire Bolt?');
    expect(question.className).toMatch(/question/);
    expect(screen.getByText('Procurando nas fontes…')).toBeTruthy();
    expect(document.querySelector('[role="progressbar"]')).toBeNull();

    await act(async () => answer({ ok: true, turn: { id: TURN, conversationId: 'c', language: 'pt-BR' } }));
    await waitFor(() => expect(streams).toHaveLength(1));
    const stream = streams[0]!;
    expect(stream.url).toBe(`/api/v1/turns/${TURN}/events`);
    expect(polite()).toBe('Respondendo…');

    stream.emit('delta', { text: 'Fire Bolt causa ' });
    expect(screen.queryByText('Procurando nas fontes…')).toBeNull();
    stream.emit('delta', { text: '**1d10** de dano.' });
    stream.emit('citation', { passageId: PASSAGE_A, offset: 16 });
    expect(turns().getByText('1d10').tagName).toBe('STRONG');
    expect(document.querySelector('hr')).toBeNull();

    stream.emit('done', doneWith(PASSAGE_A));

    expect(stream.closed).toBe(true);
    expect(document.querySelector('hr')).not.toBeNull();
    expect(polite()).toBe('Fire Bolt causa 1d10 de dano.Livro do Jogador.pdf, Magias › Fire Bolt, p. 3');
    // No bubble, card or avatar: the answer is text in the column.
    expect(document.querySelector('img')).toBeNull();
  });

  it('brings a question just asked to the top of the window, and never moves the page while its answer is written', async () => {
    // jsdom has no scrolling: the call is what is checked. The usability pass (third round) added it, because a new
    // question used to land under the docked composer once the conversation was longer than the window.
    const scrolled: { text: string; options: unknown }[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function scrollIntoView(this: Element, options?: unknown) {
      scrolled.push({ text: this.textContent ?? '', options });
    };
    const motion = vi.fn((query: string) => ({ matches: false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined }));
    vi.stubGlobal('matchMedia', motion);
    try {
      view();
      const stream = await ask('Quanto dano causa Fire Bolt?');
      expect(scrolled).toHaveLength(1);
      expect(scrolled[0]!.text).toContain('Quanto dano causa Fire Bolt?');
      expect(scrolled[0]!.options).toEqual({ block: 'start', behavior: 'smooth' });
      // The answer arrives in pieces: the page stays where the reader put it.
      stream.emit('delta', { text: 'Fire Bolt causa ' });
      stream.emit('delta', { text: '1d10 de dano.' });
      stream.emit('done', doneWith(PASSAGE_A));
      expect(scrolled).toHaveLength(1);

      // The next question moves the page again, to itself; with reduced motion it does not glide.
      motion.mockImplementation((query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener: () => undefined, removeEventListener: () => undefined }));
      postQuestion.mockResolvedValueOnce({ ok: true, turn: { id: TURN, conversationId: 'c', language: 'pt-BR' } });
      const user = userEvent.setup();
      await user.type(composer(), 'E Fireball?{Enter}');
      await waitFor(() => expect(scrolled).toHaveLength(2));
      expect(scrolled[1]!.text).toContain('E Fireball?');
      expect(scrolled[1]!.text).not.toContain('Quanto dano causa Fire Bolt?');
      expect(scrolled[1]!.options).toEqual({ block: 'start', behavior: 'auto' });
    } finally {
      Element.prototype.scrollIntoView = original;
      vi.unstubAllGlobals();
    }
  });

  it('renders the answer as sanitized Markdown: no image, a link as its text and address, no raw HTML', async () => {
    view();
    const stream = await ask('Quais links?');

    stream.emit('delta', {
      text: 'Veja ![mapa](https://evil.example/x.png) e [o SRD](https://srd.example/fire-bolt).\n\n<b>negrito</b><script>alert(1)</script><img src=x onerror=alert(1)>',
    });
    stream.emit('citation', { passageId: PASSAGE_A, offset: 4 });
    stream.emit('done', doneWith(PASSAGE_A));

    expect(document.querySelector('img')).toBeNull();
    // Story 3.10: the only links are the slim line's (the way back and "Renomear"), never in an answer.
    expect(screen.getAllByRole('list')[0]!.querySelector('a')).toBeNull();
    expect(document.querySelector('script')).toBeNull();
    expect(document.querySelector('b')).toBeNull();
    expect(turns().getByText('o SRD (https://srd.example/fire-bolt)')).toBeTruthy();
    expect(polite()).toContain('o SRD (https://srd.example/fire-bolt)');
    expect(document.body.innerHTML).not.toContain('evil.example');
    expect(document.body.innerHTML).not.toContain('onerror');
    expect(document.body.innerHTML).not.toContain('style=');
  });

  it('renders a hostile answer from a planted material as text: no anchor, image, frame or script, every link with its address (Story 2.8)', async () => {
    view();
    const stream = await ask('Copie a descrição do Corvo de Cinza.');

    stream.emit('delta', {
      text: [
        'O Corvo de Cinza tem 9 pontos de vida.',
        '',
        'Veja <https://example.invalid/auto>, [clique para curar](javascript:alert(1)) e [o grimório](https://example.invalid/grimorio).',
        '',
        '<iframe src="https://example.invalid/frame"></iframe>',
        '',
        'Mapa: ![ninho do corvo][ninho]',
        '',
        '[ninho]: https://example.invalid/ninho.png',
      ].join('\n'),
    });
    stream.emit('citation', { passageId: PASSAGE_A, offset: 38 });
    stream.emit('done', doneWith(PASSAGE_A));

    for (const tag of ['img', 'iframe', 'script']) {
      expect(document.querySelector(tag), tag).toBeNull();
    }
    // Story 3.10: the only links are the slim line's (the way back and "Renomear"), never in an answer.
    expect(screen.getAllByRole('list')[0]!.querySelector('a')).toBeNull();
    expect(turns().getByText(/https:\/\/example\.invalid\/auto/)).toBeTruthy();
    expect(turns().getByText('clique para curar (javascript:alert(1))')).toBeTruthy();
    expect(turns().getByText('o grimório (https://example.invalid/grimorio)')).toBeTruthy();
    // A reference-style image is dropped whole, its address with it; nothing loads from example.invalid.
    expect(document.body.innerHTML).not.toContain('ninho.png');
    expect(document.body.innerHTML).not.toContain('example.invalid/frame');
    expect(document.querySelectorAll('[src]')).toHaveLength(0);
    expect([...document.querySelectorAll('[href]')].map((link) => link.getAttribute('href'))).toEqual(['/questions', '/questions/c/edit']);
  });

  it('marks an answer in another language than the interface with its language and a visible label', async () => {
    view();
    const stream = await ask('What does Fire Bolt do?', 'en');
    stream.emit('delta', { text: 'Fire Bolt deals 1d10 fire damage.' });
    stream.emit('citation', { passageId: PASSAGE_A, offset: 33 });
    stream.emit('done', doneWith(PASSAGE_A));

    expect(screen.getByText('Resposta em inglês')).toBeTruthy();
    expect(turns().getByText('Fire Bolt deals 1d10 fire damage.').closest('[lang]')?.getAttribute('lang')).toBe('en');
  });

  it('gives an answer in the interface language no label and no lang', async () => {
    view();
    const stream = await ask('Quanto dano?', 'pt-BR');
    stream.emit('delta', { text: 'Um d10.' });
    expect(screen.queryByText(/Resposta em/)).toBeNull();
    expect(turns().getByText('Um d10.').closest('[lang]')).toBeNull();
  });

  it('shows the outage text of an error event in place of the answer and says it at once', async () => {
    view();
    const stream = await ask('Quanto dano?');
    stream.emit('delta', { text: 'Fire Bolt ' });

    stream.emit('error', { code: 'model.unavailable' });

    const outage = 'O serviço de IA está indisponível agora.';
    expect(stream.closed).toBe(true);
    expect(turns().getByText(outage)).toBeTruthy();
    expect(alerted()).toBe(outage);
    expect(turns().queryByText('Fire Bolt')).toBeNull();
    expect(turns().getByRole('button', { name: 'Tentar de novo' })).toBeTruthy();
  });

  it('shows the refusal of the question itself and keeps nothing waiting', async () => {
    view();
    postQuestion.mockResolvedValueOnce({ ok: false, problem: { status: 400, category: 'request', code: 'request.invalid', params: {} } });
    await userEvent.setup().type(composer(), 'x{Enter}');

    await waitFor(() => expect(turns().getByText('O pedido não é válido.')).toBeTruthy());
    expect(screen.queryByText('Procurando nas fontes…')).toBeNull();
    expect(streams).toHaveLength(0);
  });

  it('puts a refused or failed question back in the composer and its draft, unless another one was started', async () => {
    view();
    postQuestion.mockResolvedValueOnce({ ok: false, problem: { status: 503, category: 'server', code: 'server.unavailable', params: {} } });
    const user = userEvent.setup();
    await user.type(composer(), 'Quanto dano causa Fire Bolt?{Enter}');

    await waitFor(() => expect(composer().value).toBe('Quanto dano causa Fire Bolt?'));
    expect(localStorage.getItem(`${DRAFT_PREFIX}${CAMPAIGN}:new:questions`)).toBe('Quanto dano causa Fire Bolt?');

    let refuse: (value: unknown) => void = () => undefined;
    postQuestion.mockImplementationOnce(() => new Promise((resolve) => (refuse = resolve)));
    await user.keyboard('{Enter}');
    expect(composer().value).toBe('');
    await user.type(composer(), 'Outra pergunta');
    await act(async () => refuse({ ok: false, problem: { status: 400, category: 'request', code: 'request.invalid', params: {} } }));

    expect(composer().value).toBe('Outra pergunta');
    expect(localStorage.getItem(`${DRAFT_PREFIX}${CAMPAIGN}:new:questions`)).toBe('Outra pergunta');
  });

  it('takes at most 4,000 characters in the composer, as the backend does', () => {
    view();
    expect(composer().maxLength).toBe(4000);
  });

  it('keeps the text and shows the lost-connection line while the browser reconnects, until the next open', async () => {
    view();
    const stream = await ask('Quanto dano?');
    stream.emit('delta', { text: 'Fire Bolt ' }, 1);

    stream.drop();

    expect(stream.closed).toBe(false);
    expect(turns().getByText('Fire Bolt')).toBeTruthy();
    expect(turns().getByText('Conexão perdida. Tentando de novo…')).toBeTruthy();
    expect(polite()).toBe('Conexão perdida. Tentando de novo…');
    expect(turns().queryByText('Algo deu errado no servidor. Tente de novo em instantes.')).toBeNull();

    stream.open();

    expect(turns().queryByText('Conexão perdida. Tentando de novo…')).toBeNull();
    expect(streams).toHaveLength(1);
  });

  it('with no accepted source says so above the composer, opens the guided upload, links the review, and still asks', async () => {
    view({ hasSources: false, review: { href: '/files/m-1', name: 'Bestiário.pdf' } });

    expect(screen.getByText('Esta campanha ainda não tem fontes aceitas.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Revisar Bestiário.pdf' }).getAttribute('href')).toBe('/files/m-1');
    expect(composer().disabled).toBe(false);
    expect(screen.getByTestId('upload-state').textContent).toBe('closed');
    fireEvent.click(screen.getByRole('button', { name: 'Enviar um arquivo' }));
    expect(screen.getByTestId('upload-state').textContent).toBe('open');

    const stream = await ask('Pergunta sem fontes');
    expect(stream.url).toContain(TURN);
  });

  it('has every string in English too', async () => {
    view({ language: 'en', hasSources: false });
    expect(screen.getByText('This campaign has no accepted sources yet.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Upload a file' })).toBeTruthy();
    const stream = await ask('Quanto dano causa Fire Bolt?', 'pt-BR');
    expect(screen.getByText('Searching the sources…')).toBeTruthy();
    expect(polite()).toBe('Answering…');
    stream.emit('delta', { text: 'Um d10.' });
    expect(screen.getByText('Answer in Portuguese')).toBeTruthy();
  });
});

describe('sources under every answer (Story 2.5)', () => {
  beforeEach(() => {
    streams = [];
    postQuestion.mockReset();
    localStorage.clear();
  });
  afterEach(() => {
    cleanup();
  });

  it('shows no superscript and no list while the answer streams', async () => {
    view();
    const stream = await ask('Quanto dano?');
    stream.emit('delta', { text: 'Fire Bolt causa 1d10.' });
    stream.emit('citation', { passageId: PASSAGE_A, offset: 21 });
    stream.emit('delta', { text: ' Mais.' });

    expect(document.querySelector('sup')).toBeNull();
    expect(screen.queryByRole('list', { name: 'Fontes' })).toBeNull();
    expect(screen.queryByText(/Livro do Jogador/)).toBeNull();

    stream.emit('done', doneWith(PASSAGE_A));

    expect(superscripts()).toEqual(['1']);
    expect(screen.getAllByRole('list', { name: 'Fontes' })).toHaveLength(2);
  });

  it('places superscripts at code-point offsets of the Markdown text, after an emoji too', async () => {
    view();
    const stream = await ask('Quanto dano?');
    // "😀" is one code point but two UTF-16 units: offsets count code points.
    stream.emit('delta', { text: '😀 Fogo. Gelo.' });
    stream.emit('citation', { passageId: PASSAGE_A, offset: 7 });
    stream.emit('citation', { passageId: PASSAGE_B, offset: 13 });
    stream.emit('citation', { passageId: PASSAGE_A, offset: 13 });
    stream.emit('done', {
      silent: false,
      references: [reference(1, [PASSAGE_A]), reference(2, [PASSAGE_B], { page: 9 })],
    });

    const paragraph = turns().getByText((_, element) => element?.tagName === 'P' && (element.textContent ?? '').startsWith('😀'));
    const parts = [...paragraph.childNodes].map((node) => `${node.nodeName}:${node.nodeName === 'SUP' ? shown(node) : node.textContent}`);
    expect(parts).toEqual(['#text:😀 Fogo.', 'SUP:1', '#text: Gelo.', 'SUP:2', 'SUP:1']);
    for (const sup of paragraph.querySelectorAll('sup')) {
      expect(sup.className).toMatch(/citation/);
    }
    expect(document.body.innerHTML).not.toContain('style=');
  });

  it('gives passages cited at the same place one number', async () => {
    view();
    const stream = await ask('Quanto dano?');
    stream.emit('delta', { text: 'Um. Dois.' });
    stream.emit('citation', { passageId: PASSAGE_A, offset: 3 });
    stream.emit('citation', { passageId: PASSAGE_B, offset: 9 });
    stream.emit('done', doneWith(PASSAGE_A, PASSAGE_B));

    expect(superscripts()).toEqual(['1', '1']);
    const list = screen.getAllByRole('list', { name: 'Fontes' })[0]!;
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
  });

  it('shows nothing for a citation with no matching reference', async () => {
    view();
    const stream = await ask('Quanto dano?');
    stream.emit('delta', { text: 'Um. Dois.' });
    stream.emit('citation', { passageId: PASSAGE_C, offset: 3 });
    stream.emit('citation', { passageId: PASSAGE_A, offset: 9 });
    stream.emit('done', doneWith(PASSAGE_A));

    expect(superscripts()).toEqual(['1']);
    expect(turns().getByText((_, element) => element?.tagName === 'P' && element.textContent === 'Um. Dois.fonte 1')).toBeTruthy();
  });

  it('says a visually hidden word before each superscript\'s number, in the answer\'s language', async () => {
    view();
    const stream = await ask('Quanto dano?');
    stream.emit('delta', { text: 'Fire Bolt causa dano de fogo.' });
    stream.emit('citation', { passageId: PASSAGE_A, offset: 29 });
    stream.emit('done', doneWith(PASSAGE_A));

    const sup = document.querySelector('sup')!;
    expect(sup.textContent).toBe('fonte 1');
    const word = sup.firstElementChild!;
    expect(word.tagName).toBe('SPAN');
    expect(word.className).toMatch(/visuallyHidden/);
    expect(word.textContent).toBe('fonte ');
    cleanup();
    streams = [];
    view();
    const english = await ask('What does Fire Bolt do?', 'en');
    english.emit('delta', { text: 'It deals fire damage.' });
    english.emit('citation', { passageId: PASSAGE_A, offset: 21 });
    english.emit('done', doneWith(PASSAGE_A));
    expect(document.querySelector('sup')?.textContent).toBe('source 1');
  });

  it('puts a citation past the end of the text at its end', async () => {
    view();
    const stream = await ask('Quanto dano?');
    stream.emit('delta', { text: 'Um.' });
    stream.emit('citation', { passageId: PASSAGE_A, offset: 50 });
    stream.emit('done', doneWith(PASSAGE_A));

    expect(superscripts()).toEqual(['1']);
    const paragraph = document.querySelector('sup')!.parentElement!;
    expect(paragraph.tagName).toBe('P');
    expect(paragraph.lastChild?.nodeName).toBe('SUP');
    expect(paragraph.firstChild?.textContent).toBe('Um.');
  });

  it('keeps a fully bold cited sentence bold, with the superscript inside and no literal asterisk', async () => {
    view();
    const stream = await ask('Quanto dano?');
    const text = '**Fire Bolt causa 1d10.**';
    stream.emit('delta', { text });
    stream.emit('citation', { passageId: PASSAGE_A, offset: Array.from(text).length });
    stream.emit('done', doneWith(PASSAGE_A));

    const strong = turns().getByText((_, element) => element?.tagName === 'STRONG');
    expect(strong.firstChild?.textContent).toBe('Fire Bolt causa 1d10.');
    expect(strong.querySelector('sup')).not.toBeNull();
    expect(superscripts()).toEqual(['1']);
    expect(screen.getAllByRole('list')[0]!.textContent).not.toContain('*');
  });

  it('puts a citation just after a paragraph break at the end of that paragraph, keeping the next heading', async () => {
    view();
    const stream = await ask('Quanto dano?');
    const first = 'Um parágrafo.\n\n';
    stream.emit('delta', { text: `${first}## Título\n\nMais.` });
    stream.emit('citation', { passageId: PASSAGE_A, offset: Array.from(first).length });
    stream.emit('done', doneWith(PASSAGE_A));

    const heading = turns().getByRole('heading', { level: 2 });
    expect(heading.textContent).toBe('Título');
    const sup = document.querySelector('sup')!;
    expect(sup.parentElement?.tagName).toBe('P');
    expect(sup.parentElement?.firstChild?.textContent).toBe('Um parágrafo.');
    expect(sup.parentElement?.nextElementSibling).toBe(heading);
  });

  it('lists the references in label type under the answer and above the rule, a removed one struck through', async () => {
    view();
    const stream = await ask('Quanto dano?');
    stream.emit('delta', { text: 'Um. Dois.' });
    stream.emit('citation', { passageId: PASSAGE_A, offset: 3 });
    stream.emit('citation', { passageId: PASSAGE_B, offset: 9 });
    stream.emit('done', {
      silent: false,
      references: [reference(1, [PASSAGE_A]), reference(2, [PASSAGE_B], { materialName: 'Bestiário.pdf', sectionPath: [], page: 12, removed: true })],
    });

    const list = screen.getAllByRole('list', { name: 'Fontes' })[0]!;
    expect(list.className).toMatch(/references/);
    const items = within(list).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'Livro do Jogador.pdf, Magias › Fire Bolt, p. 3',
      'Bestiário.pdf, p. 12 — fonte removida',
    ]);
    expect(items.map((item) => item.getAttribute('value'))).toEqual(['1', '2']);
    const struck = items[1]!.querySelector('s');
    expect(struck?.textContent).toBe('Bestiário.pdf, p. 12');
    expect(items[0]!.querySelector('s')).toBeNull();
    // Story 2.7: a reference's line is a button named by its line; a removed one has none and stays struck through.
    expect(within(items[0]!).getByRole('button').textContent).toBe('Livro do Jogador.pdf, Magias › Fire Bolt, p. 3');
    expect(within(items[0]!).getByRole('button', { name: 'Livro do Jogador.pdf, Magias › Fire Bolt, p. 3' })).toBeTruthy();
    expect(items[1]!.querySelector('a, button')).toBeNull();
    // The superscripts stay plain text.
    expect(document.querySelector('sup a, sup button')).toBeNull();
    // Under the answer, above the closing rule.
    const turn = list.closest('li')!;
    const order = [...turn.children].map((child) => child.tagName);
    expect(order.indexOf('OL')).toBeGreaterThan(order.indexOf('DIV'));
    expect(order.indexOf('HR')).toBeGreaterThan(order.indexOf('OL'));
  });

  it('replaces a silent answer with the fixed sentence in the turn\'s language: no list, no superscript, no label', async () => {
    view();
    const stream = await ask('What does Fire Bolt do?', 'en');
    stream.emit('delta', { text: 'Some uncited words about it.' });
    stream.emit('done', { silent: true, references: [] });

    expect(turns().queryByText('Some uncited words about it.')).toBeNull();
    expect(turns().getByText('The sources say nothing about this.')).toBeTruthy();
    expect(screen.queryByText('Resposta em inglês')).toBeNull();
    expect(screen.queryAllByRole('list', { name: 'Fontes' })).toHaveLength(0);
    expect(document.querySelector('sup')).toBeNull();
    // Story 3.8: with model knowledge off (absent), the offer under it is said too, in the same language.
    expect(polite()).toBe('The sources say nothing about this. Widen the sources or turn on model knowledge.');
    expect(document.querySelector('hr')).not.toBeNull();
  });

  it('gives a silent answer of an unsure language the interface language, and treats a done with no reference as silent', async () => {
    view();
    const stream = await ask('Hmm?', null);
    stream.emit('delta', { text: 'Texto sem fonte.' });
    stream.emit('citation', { passageId: PASSAGE_A, offset: 5 });
    // No well-formed reference left: silent, whatever the event said.
    stream.emit('done', { silent: false, references: [{ number: 1, passageIds: [PASSAGE_A] }] });

    expect(turns().queryByText('Texto sem fonte.')).toBeNull();
    expect(turns().getByText('As fontes não dizem nada sobre isso.')).toBeTruthy();
    expect(document.querySelector('sup')).toBeNull();
  });

  it('says the finished answer, then the references as a list, in the polite region', async () => {
    view();
    const stream = await ask('Quanto dano?');
    stream.emit('delta', { text: 'Fire Bolt causa **1d10**.' });
    stream.emit('citation', { passageId: PASSAGE_A, offset: 25 });
    stream.emit('done', {
      silent: false,
      references: [reference(1, [PASSAGE_A]), reference(2, [PASSAGE_B], { removed: true, page: 4 })],
    });

    const region = screen.getByTestId('conversation-polite');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.firstElementChild?.tagName).toBe('P');
    expect(region.firstElementChild?.textContent).toBe('Fire Bolt causa 1d10.');
    const list = region.querySelector('ol');
    expect(list?.getAttribute('aria-label')).toBe('Fontes');
    expect([...(list?.querySelectorAll('li') ?? [])].map((item) => item.textContent)).toEqual([
      'Livro do Jogador.pdf, Magias › Fire Bolt, p. 3',
      'Livro do Jogador.pdf, Magias › Fire Bolt, p. 4 — fonte removida',
    ]);
    expect(region.querySelector('sup')).toBeNull();
  });

  it('never turns a private-use code point of the model text into a superscript: it stays the text\'s own', async () => {
    view();
    const stream = await ask('Quanto dano?');
    const text = `Um${String.fromCodePoint(0xf0007)} dois.`;
    stream.emit('delta', { text });
    stream.emit('citation', { passageId: PASSAGE_A, offset: 9 });
    stream.emit('done', doneWith(PASSAGE_A));

    expect(superscripts()).toEqual(['1']);
    const sup = document.querySelector('sup')!;
    expect(sup.previousSibling?.textContent).toBe(text);
    expect(sup.parentElement?.textContent).toBe(`${text}fonte 1`);
  });

  it('has the references and the silent sentence in English too', async () => {
    view({ language: 'en' });
    const stream = await ask('What does Fire Bolt do?', 'en');
    stream.emit('delta', { text: 'It deals 1d10.' });
    stream.emit('citation', { passageId: PASSAGE_A, offset: 14 });
    stream.emit('done', { silent: false, references: [reference(1, [PASSAGE_A], { removed: true })] });

    const list = screen.getAllByRole('list', { name: 'Sources' })[0]!;
    expect(within(list).getByRole('listitem').textContent).toBe('Livro do Jogador.pdf, Magias › Fire Bolt, p. 3 — source removed');
    cleanup();
    streams = [];
    view({ language: 'en' });
    const silent = await ask('Quanto dano?', 'pt-BR');
    silent.emit('done', { silent: true, references: [] });
    expect(turns().getByText('As fontes não dizem nada sobre isso.')).toBeTruthy();
  });
});

describe('stop an answer, and answers that fail clearly (Story 2.6)', () => {
  beforeEach(() => {
    streams = [];
    postQuestion.mockReset();
    stopTurn.mockReset();
    stopTurn.mockResolvedValue(true);
    localStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it('turns send into Stop while the answer runs; a stopped answer keeps its text, references and the Interrompida mark', async () => {
    view();
    const stream = await ask('Quanto dano causa Fire Bolt?');
    expect(screen.queryByRole('button', { name: 'Enviar' })).toBeNull();
    stream.emit('delta', { text: 'Fire Bolt causa ' }, 1);
    stream.emit('citation', { passageId: PASSAGE_A, offset: 16 }, 2);
    stream.emit('delta', { text: '1d10 de' }, 3);

    const stopButton = screen.getByRole('button', { name: 'Parar' });
    expect(stopButton.querySelector('svg rect')).not.toBeNull();
    fireEvent.click(stopButton);
    expect(stopTurn).toHaveBeenCalledWith(TURN);

    stream.emit('done', { stopped: true, silent: false, references: [reference(1, [PASSAGE_A])] }, 4);

    expect(stream.closed).toBe(true);
    expect(turns().getByText(/Fire Bolt causa/)).toBeTruthy();
    expect(turns().getByText('Interrompida')).toBeTruthy();
    expect(superscripts()).toEqual(['1']);
    expect(screen.getAllByRole('list', { name: 'Fontes' })).not.toHaveLength(0);
    expect(turns().queryByText('As fontes não dizem nada sobre isso.')).toBeNull();
    expect(polite()).toBe('Fire Bolt causa 1d10 deInterrompidaLivro do Jogador.pdf, Magias › Fire Bolt, p. 3');
    expect(document.querySelector('hr')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeTruthy();
    expect(document.body.innerHTML).not.toContain('style=');
  });

  it('never replaces a stopped answer with no reference by the silent sentence, even with no text', async () => {
    view();
    const stream = await ask('Quanto dano?');
    stream.emit('delta', { text: 'Fire Bolt ' }, 1);
    stream.emit('done', { stopped: true, silent: false, references: [] }, 2);

    expect(turns().getByText('Fire Bolt')).toBeTruthy();
    expect(turns().getByText('Interrompida')).toBeTruthy();
    expect(turns().queryByText('As fontes não dizem nada sobre isso.')).toBeNull();
    expect(screen.queryAllByRole('list', { name: 'Fontes' })).toHaveLength(0);

    cleanup();
    streams = [];
    view();
    const empty = await ask('Quanto dano?');
    empty.emit('done', { stopped: true, silent: true, references: [] }, 1);
    expect(turns().getByText('Interrompida')).toBeTruthy();
    expect(turns().queryByText('As fontes não dizem nada sobre isso.')).toBeNull();
    expect(polite()).toBe('Interrompida');
  });

  it('stops with Esc from anywhere on the screen', async () => {
    view();
    const stream = await ask('Quanto dano?');
    stream.emit('delta', { text: 'Fire Bolt ' }, 1);
    (document.activeElement as HTMLElement | null)?.blur();

    await userEvent.setup().keyboard('{Escape}');

    expect(stopTurn).toHaveBeenCalledWith(TURN);
    // Esc inside a dialog belongs to that dialog.
    stopTurn.mockClear();
    const dialog = document.createElement('dialog');
    const inside = document.createElement('button');
    dialog.append(inside);
    document.body.append(dialog);
    fireEvent.keyDown(inside, { key: 'Escape' });
    expect(stopTurn).not.toHaveBeenCalled();
    dialog.remove();
    // Esc that only cancels an IME composition is not a stop.
    fireEvent.keyDown(document.body, { key: 'Escape', isComposing: true });
    expect(stopTurn).not.toHaveBeenCalled();
    stream.emit('done', { stopped: false, silent: true, references: [] }, 2);
    await userEvent.setup().keyboard('{Escape}');
    expect(stopTurn).not.toHaveBeenCalled();
  });

  it('sends nothing with Enter while an answer runs, and keeps the draft', async () => {
    view();
    const stream = await ask('Quanto dano?');
    const user = userEvent.setup();
    await user.type(composer(), 'Outra pergunta{Enter}');

    expect(postQuestion).toHaveBeenCalledTimes(1);
    expect(composer().value).toBe('Outra pergunta');

    stream.emit('done', { stopped: false, silent: true, references: [] }, 1);
    postQuestion.mockResolvedValueOnce({ ok: true, turn: { id: TURN, conversationId: 'c', language: 'pt-BR' } });
    await user.keyboard('{Enter}');
    expect(postQuestion).toHaveBeenLastCalledWith(CAMPAIGN, 'Outra pergunta', { conversationId: 'c' });
  });

  it('sends a stop pressed before the turn id is known as soon as the id arrives', async () => {
    view();
    let answer: (value: unknown) => void = () => undefined;
    postQuestion.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    await userEvent.setup().type(composer(), 'Quanto dano?{Enter}');

    fireEvent.click(screen.getByRole('button', { name: 'Parar' }));
    expect(stopTurn).not.toHaveBeenCalled();

    await act(async () => answer({ ok: true, turn: { id: TURN, conversationId: 'c', language: 'pt-BR' } }));

    expect(stopTurn).toHaveBeenCalledWith(TURN);
    expect(streams).toHaveLength(1);
    streams[0]!.emit('done', { stopped: true, silent: false, references: [] }, 1);
    expect(turns().getByText('Interrompida')).toBeTruthy();
  });

  it('keeps a truncated answer\'s text, with the truncation text and Tentar de novo, said at once', async () => {
    view();
    const stream = await ask('Quanto dano?');
    stream.emit('delta', { text: 'Fire Bolt causa ' }, 1);
    stream.emit('delta', { text: '1d10' }, 2);

    stream.emit('error', { code: 'model.truncated' }, 3);

    expect(turns().getByText('Fire Bolt causa 1d10')).toBeTruthy();
    expect(turns().getByText('A resposta foi cortada antes do fim.')).toBeTruthy();
    expect(turns().getByRole('button', { name: 'Tentar de novo' })).toBeTruthy();
    expect(screen.queryAllByRole('list', { name: 'Fontes' })).toHaveLength(0);
    expect(alerted()).toBe('A resposta foi cortada antes do fim.');
    expect(screen.getByTestId('conversation-alert').getAttribute('role')).toBe('alert');
  });

  it('hides a refused answer\'s text, puts the question back in an empty composer, offers no retry, and says it at once', async () => {
    view();
    const stream = await ask('Quanto dano causa Fire Bolt?');
    stream.emit('delta', { text: 'Fire ' }, 1);
    stream.emit('delta', { text: 'Bolt' }, 2);

    stream.emit('error', { code: 'model.refused' }, 3);

    const refusal = 'O modelo recusou este pedido. Reformule a pergunta e envie de novo.';
    expect(turns().getByText(refusal)).toBeTruthy();
    expect(turns().queryByText('Fire Bolt')).toBeNull();
    expect(turns().queryByRole('button', { name: 'Tentar de novo' })).toBeNull();
    expect(composer().value).toBe('Quanto dano causa Fire Bolt?');
    expect(alerted()).toBe(refusal);
  });

  // Story 2.8: a provider's prompt filter that flagged the question or a source acts like a refusal, with its own text.
  it.each([
    {
      code: 'model.question_flagged',
      language: 'pt-BR' as const,
      text: 'O filtro de segurança do provedor de IA bloqueou esta pergunta porque ela parece tentar mudar as instruções do assistente. Reformule a pergunta e envie de novo.',
    },
    {
      code: 'model.source_flagged',
      language: 'pt-BR' as const,
      text: 'O filtro de segurança do provedor de IA bloqueou esta pergunta porque um trecho das fontes consultadas parece uma instrução ao assistente. Revise os arquivos usados como fonte ou reformule a pergunta.',
    },
    {
      code: 'model.question_flagged',
      language: 'en' as const,
      text: "The AI provider's safety filter blocked this question because it seems to try to change the assistant's instructions. Rephrase the question and send it again.",
    },
    {
      code: 'model.source_flagged',
      language: 'en' as const,
      text: "The AI provider's safety filter blocked this question because a passage in the sources consulted looks like an instruction to the assistant. Review the files used as sources or rephrase the question.",
    },
  ])('shows $code in $language as a refusal of its own: no retry, the question back in the composer', async ({ code, language, text }) => {
    view({ language });
    const stream = await ask('How much damage does the Amber Blade deal?', 'en');
    stream.emit('delta', { text: 'The Amber ' }, 1);

    stream.emit('error', { code }, 2);

    expect(turns().getByText(text)).toBeTruthy();
    expect(turns().queryByText('The Amber')).toBeNull();
    expect(turns().queryByText(language === 'en' ? 'The model declined this request. Rephrase the question and send it again.' : 'O modelo recusou este pedido. Reformule a pergunta e envie de novo.')).toBeNull();
    expect(turns().queryByRole('button', { name: language === 'en' ? 'Try again' : 'Tentar de novo' })).toBeNull();
    expect(composer().value).toBe('How much damage does the Amber Blade deal?');
    expect(alerted()).toBe(text);
  });

  // A prompt filter blocks the call before the model writes anything: the error is the turn's first event.
  it.each([
    { code: 'model.question_flagged', text: 'O filtro de segurança do provedor de IA bloqueou esta pergunta porque ela parece tentar mudar as instruções do assistente. Reformule a pergunta e envie de novo.' },
    { code: 'model.source_flagged', text: 'O filtro de segurança do provedor de IA bloqueou esta pergunta porque um trecho das fontes consultadas parece uma instrução ao assistente. Revise os arquivos usados como fonte ou reformule a pergunta.' },
  ])('shows $code before any text as a refusal of its own', async ({ code, text }) => {
    view();
    const stream = await ask('Quanto dano causa a Lâmina de Âmbar?');

    stream.emit('error', { code }, 1);

    expect(turns().getByText(text)).toBeTruthy();
    expect(screen.queryByText('Procurando nas fontes…')).toBeNull();
    expect(turns().queryByRole('button', { name: 'Tentar de novo' })).toBeNull();
    expect(composer().value).toBe('Quanto dano causa a Lâmina de Âmbar?');
    expect(alerted()).toBe(text);
  });

  it('re-asks an outage in place with Tentar de novo', async () => {
    view();
    const stream = await ask('Quanto dano causa Fire Bolt?');
    stream.emit('error', { code: 'job.attempts_exhausted' }, 1);
    expect(turns().getByText('O serviço de IA está indisponível agora.')).toBeTruthy();

    postQuestion.mockResolvedValueOnce({ ok: true, turn: { id: TURN, conversationId: 'c', language: 'pt-BR' } });
    fireEvent.click(turns().getByRole('button', { name: 'Tentar de novo' }));

    await waitFor(() => expect(streams).toHaveLength(2));
    expect(postQuestion).toHaveBeenLastCalledWith(CAMPAIGN, 'Quanto dano causa Fire Bolt?', { conversationId: 'c' });
    expect(turns().getAllByText('Quanto dano causa Fire Bolt?')).toHaveLength(1);
    expect(turns().queryByText('O serviço de IA está indisponível agora.')).toBeNull();
    streams[1]!.emit('delta', { text: 'Um d10.' }, 1);
    expect(turns().getByText('Um d10.')).toBeTruthy();
  });

  it('reopens a stream the browser gave up from the last event id, backing off, with no repeated text', async () => {
    view();
    const stream = await ask('Quanto dano?');
    for (let id = 1; id <= 7; id += 1) {
      stream.emit('delta', { text: `${id} ` }, id);
    }
    vi.useFakeTimers();

    stream.drop(true);

    expect(stream.closed).toBe(true);
    expect(turns().getByText('Conexão perdida. Tentando de novo…')).toBeTruthy();
    act(() => vi.advanceTimersByTime(999));
    expect(streams).toHaveLength(1);
    act(() => vi.advanceTimersByTime(1));
    expect(streams).toHaveLength(2);
    expect(streams[1]!.url).toBe(`/api/v1/turns/${TURN}/events?lastEventId=7`);

    // It fails again: the next wait is 2 s.
    streams[1]!.drop(true);
    act(() => vi.advanceTimersByTime(1999));
    expect(streams).toHaveLength(2);
    act(() => vi.advanceTimersByTime(1));
    expect(streams).toHaveLength(3);
    const resumed = streams[2]!;
    expect(resumed.url).toBe(`/api/v1/turns/${TURN}/events?lastEventId=7`);

    resumed.open();
    expect(turns().queryByText('Conexão perdida. Tentando de novo…')).toBeNull();
    resumed.emit('delta', { text: '7 ' }, 7);
    resumed.emit('delta', { text: '8' }, 8);
    expect(turns().getByText('1 2 3 4 5 6 7 8')).toBeTruthy();
  });

  it('gives up after 2 minutes without an open, offering Tentar de novo, which reopens the stream', async () => {
    view();
    const stream = await ask('Quanto dano?');
    stream.emit('delta', { text: 'Fire Bolt ' }, 3);
    vi.useFakeTimers();

    stream.drop();
    act(() => vi.advanceTimersByTime(RECONNECT_GIVE_UP_MS - 1));
    expect(turns().getByText('Conexão perdida. Tentando de novo…')).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));

    expect(stream.closed).toBe(true);
    expect(turns().getByText('Não foi possível reconectar.')).toBeTruthy();
    expect(polite()).toBe('Não foi possível reconectar.');
    expect(turns().getByText('Fire Bolt')).toBeTruthy();

    fireEvent.click(turns().getByRole('button', { name: 'Tentar de novo' }));

    expect(streams).toHaveLength(2);
    expect(streams[1]!.url).toBe(`/api/v1/turns/${TURN}/events?lastEventId=3`);
    expect(turns().getByText('Conexão perdida. Tentando de novo…')).toBeTruthy();
    streams[1]!.open();
    expect(turns().queryByText('Conexão perdida. Tentando de novo…')).toBeNull();
  });

  it('keeps a failed turn\'s Tentar de novo disabled while another answer runs', async () => {
    view();
    const failed = await ask('Quanto dano causa Fire Bolt?');
    failed.emit('error', { code: 'model.unavailable' }, 1);
    postQuestion.mockResolvedValueOnce({ ok: true, turn: { id: TURN, conversationId: 'c', language: 'pt-BR' } });
    await userEvent.setup().type(composer(), 'Outra pergunta{Enter}');
    await waitFor(() => expect(streams).toHaveLength(2));

    const retry = turns().getByRole('button', { name: 'Tentar de novo' }) as HTMLButtonElement;
    expect(retry.disabled).toBe(true);
    fireEvent.click(retry);

    expect(postQuestion).toHaveBeenCalledTimes(2);
  });

  it('ignores the second click of a double-click on Send, which lands on Stop', async () => {
    view();
    postQuestion.mockResolvedValueOnce({ ok: true, turn: { id: TURN, conversationId: 'c', language: 'pt-BR' } });
    await userEvent.setup().type(composer(), 'Quanto dano?');
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }), { detail: 1 });
    await waitFor(() => expect(streams).toHaveLength(1));

    fireEvent.click(screen.getByRole('button', { name: 'Parar' }), { detail: 2 });
    expect(stopTurn).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Parar' }), { detail: 1 });
    expect(stopTurn).toHaveBeenCalledWith(TURN);
  });

  it('says the generic server text at once when the stop is refused', async () => {
    view();
    await ask('Quanto dano?');
    stopTurn.mockResolvedValueOnce(false);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Parar' }));
    });

    expect(alerted()).toBe(errorText({ category: 'server', code: 'server.unavailable' }, 'pt-BR'));
    expect(screen.getByRole('button', { name: 'Parar' })).toBeTruthy();
  });

  it('reopens a given-up stream when Stop is accepted, so the stopped done arrives', async () => {
    view();
    const stream = await ask('Quanto dano?');
    stream.emit('delta', { text: 'Fire Bolt ' }, 4);
    vi.useFakeTimers();
    stream.drop();
    act(() => vi.advanceTimersByTime(RECONNECT_GIVE_UP_MS));
    expect(turns().getByText('Não foi possível reconectar.')).toBeTruthy();
    vi.useRealTimers();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Parar' }));
    });

    expect(stopTurn).toHaveBeenCalledWith(TURN);
    expect(streams).toHaveLength(2);
    expect(streams[1]!.url).toBe(`/api/v1/turns/${TURN}/events?lastEventId=4`);
    streams[1]!.open();
    streams[1]!.emit('done', { stopped: true, silent: false, references: [] }, 5);
    expect(turns().getByText('Interrompida')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeTruthy();
  });

  it('has the stop and failure strings in English too', async () => {
    view({ language: 'en' });
    const stream = await ask('What does Fire Bolt do?', 'en');
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy();
    stream.emit('delta', { text: 'It deals' }, 1);
    stream.emit('done', { stopped: true, silent: false, references: [] }, 2);
    expect(turns().getByText('Stopped')).toBeTruthy();

    cleanup();
    streams = [];
    view({ language: 'en' });
    const failed = await ask('What does Fire Bolt do?', 'en');
    failed.emit('error', { code: 'model.unavailable' }, 1);
    expect(turns().getByText('The AI service is unavailable right now.')).toBeTruthy();
    expect(turns().getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});

describe('open the cited page in the source view (Story 2.7)', () => {
  const PICTURE_PAGE = (page: number) => ({
    page,
    pageTotal: 4,
    picture: { width: 1000, height: 2000 },
    lines: [{ text: `Linha ${page}`, box: [0.1, 0.2, 0.5, 0.22] }],
    text: null,
    passages: page === 3 ? [{ id: PASSAGE_A, boxes: [[0.1, 0.19, 0.7, 0.26]] }] : [],
    outcome: 'read_directly',
  });
  let load: ReturnType<typeof vi.fn<LoadPage>>;

  beforeEach(() => {
    streams = [];
    postQuestion.mockReset();
    stopTurn.mockReset();
    stopTurn.mockResolvedValue(true);
    localStorage.clear();
    load = vi.fn<LoadPage>(async (_turn, _number, page) => PICTURE_PAGE(page));
  });
  afterEach(() => {
    cleanup();
  });

  /** A finished answer citing A (reference 1, p. 3) and B (reference 2, p. 12, or removed). */
  async function answered(removed = false): Promise<void> {
    const stream = await ask('Quanto dano?');
    stream.emit('delta', { text: 'Um. Dois.' }, 1);
    stream.emit('citation', { passageId: PASSAGE_A, offset: 3 }, 2);
    stream.emit('citation', { passageId: PASSAGE_B, offset: 9 }, 3);
    stream.emit(
      'done',
      {
        stopped: false,
        silent: false,
        references: [reference(1, [PASSAGE_A]), reference(2, [PASSAGE_B], { materialName: 'Bestiário.pdf', sectionPath: [], page: 12, removed })],
      },
      4,
    );
  }

  it('scrolls its panel so the first cited passage sits in the middle, and opens a page with none at its top', async () => {
    const { SourceView } = await import('@/components/SourceView');
    // jsdom has no layout: the panel is 600px high at the top of the window, the cited box 900px down the page.
    const boxes = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this.tagName.toLowerCase() === 'aside') {
        return DOMRect.fromRect({ x: 0, y: 0, width: 560, height: 600 });
      }
      if (this.hasAttribute('data-cited')) {
        return DOMRect.fromRect({ x: 0, y: 900 - (this.closest('aside')?.scrollTop ?? 0), width: 300, height: 40 });
      }
      return DOMRect.fromRect({ x: 0, y: 0, width: 0, height: 0 });
    });
    try {
      render(
        <aside data-testid="panel">
          <SourceView turnId={TURN} reference={reference(1, [PASSAGE_A])} language="pt-BR" onClose={() => undefined} load={load as never} />
        </aside>,
      );
      const panel = screen.getByTestId('panel');
      // Page 3 carries the cited passage: its middle (920) goes to the panel's middle (300).
      await waitFor(() => expect(panel.scrollTop).toBe(620));
      expect(panel.querySelectorAll('[data-cited]').length).toBeGreaterThan(0);
      // The next page has no cited passage: it opens at its top.
      await userEvent.setup().click(screen.getByRole('button', { name: 'Próxima página' }));
      await waitFor(() => expect(screen.getByText('p. 4')).toBeTruthy());
      await waitFor(() => expect(panel.scrollTop).toBe(0));
      expect(panel.querySelector('[data-cited]')).toBeNull();
    } finally {
      boxes.mockRestore();
    }
  });

  it('marks the cited range of a text page for the scroll too', async () => {
    const { SourceView } = await import('@/components/SourceView');
    load.mockResolvedValue({ page: 3, pageTotal: 3, picture: null, lines: [], text: '# Magias\n\nFire Bolt causa 1d10.', passages: [{ id: PASSAGE_A, range: [10, 31] }], outcome: 'read_directly' });
    render(
      <aside>
        <SourceView turnId={TURN} reference={reference(1, [PASSAGE_A])} language="pt-BR" onClose={() => undefined} load={load as never} />
      </aside>,
    );
    const cited = await screen.findByText('Fire Bolt causa 1d10.');
    expect(cited.tagName.toLowerCase()).toBe('mark');
    expect(cited.hasAttribute('data-cited')).toBe(true);
  });

  function referenceButton(name: string): HTMLButtonElement {
    return within(screen.getAllByRole('list', { name: /^(Fontes|Sources)$/ })[0]!).getByRole('button', { name }) as HTMLButtonElement;
  }

  const FIRST = 'Livro do Jogador.pdf, Magias › Fire Bolt, p. 3';

  it('opens the panel at once with the frame and p. N, focus on its close control, then the page with the cited passage marked', async () => {
    let answer: (value: unknown) => void = () => undefined;
    load.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    view({ loadPage: load });
    await answered();
    const user = userEvent.setup();

    await user.click(referenceButton(FIRST));

    const dialog = screen.getByRole('dialog', { name: 'Livro do Jogador.pdf, Magias › Fire Bolt' });
    expect(within(dialog).getByText('p. 3')).toBeTruthy();
    expect(dialog.querySelector('[class*="frame"]')).not.toBeNull();
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Fechar a fonte' }));
    expect(load).toHaveBeenCalledWith(TURN, 1, 3, expect.any(AbortSignal));

    await act(async () => answer(PICTURE_PAGE(3)));

    const image = dialog.querySelector('image')!;
    expect(image.getAttribute('href')).toBe(`/api/v1/turns/${TURN}/references/1/pages/3/picture`);
    expect(within(dialog).getByRole('group', { name: 'trecho citado' }).textContent).toBe('Linha 3');
    expect(dialog.querySelectorAll('rect[class*="passage"]')).toHaveLength(1);
    // The page number shows once, in the footer: no "Página 3 de 4" caption under the page.
    expect(dialog.querySelector('figcaption')).toBeNull();
    expect(within(dialog).getByText('p. 3')).toBeTruthy();
    expect(document.body.innerHTML).not.toContain('style=');
  });

  it('moves one page with the arrows only while focus is in the panel, and with the footer controls, disabled at either end', async () => {
    view({ loadPage: load });
    await answered();
    const user = userEvent.setup();
    await user.click(referenceButton(FIRST));
    const dialog = screen.getByRole('dialog');
    await waitFor(() => expect(dialog.querySelector('image')).not.toBeNull());

    await user.keyboard('{ArrowRight}');
    await within(dialog).findByRole('group', { name: 'Página 4 de 4' });
    expect(load).toHaveBeenLastCalledWith(TURN, 1, 4, expect.any(AbortSignal));
    // The next page: nothing on it is cited.
    expect(within(dialog).queryByRole('group', { name: 'trecho citado' })).toBeNull();
    const next = within(dialog).getByRole('button', { name: 'Próxima página' }) as HTMLButtonElement;
    const previous = within(dialog).getByRole('button', { name: 'Página anterior' }) as HTMLButtonElement;
    expect(next.disabled).toBe(true);
    await user.keyboard('{ArrowRight}');
    expect(load).toHaveBeenCalledTimes(2);

    await user.click(previous);
    await within(dialog).findByRole('group', { name: 'Página 3 de 4' });
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    await within(dialog).findByRole('group', { name: 'Página 1 de 4' });
    expect(previous.disabled).toBe(true);
    // Previous reached the first page with focus on it: focus moved exactly to Next.
    expect(document.activeElement).toBe(next);
    const calls = load.mock.calls.length;
    await user.keyboard('{ArrowLeft}');
    expect(load).toHaveBeenCalledTimes(calls);

    // With focus outside the panel, the arrows do nothing to it.
    composer().focus();
    await user.keyboard('{ArrowRight}');
    expect(load).toHaveBeenCalledTimes(calls);
    expect(within(dialog).getByText('p. 1')).toBeTruthy();
  });

  it('gives focus to Previous when Next reaches the last page, and to Next when Previous reaches the first', async () => {
    view({ loadPage: load });
    await answered();
    const user = userEvent.setup();
    await user.click(referenceButton(FIRST));
    const dialog = screen.getByRole('dialog');
    await within(dialog).findByRole('group', { name: 'Página 3 de 4' });
    const next = within(dialog).getByRole('button', { name: 'Próxima página' }) as HTMLButtonElement;
    const previous = within(dialog).getByRole('button', { name: 'Página anterior' }) as HTMLButtonElement;

    await user.click(next);
    await within(dialog).findByRole('group', { name: 'Página 4 de 4' });
    expect(next.disabled).toBe(true);
    expect(document.activeElement).toBe(previous);

    await user.click(previous);
    await within(dialog).findByRole('group', { name: 'Página 3 de 4' });
    expect(document.activeElement).toBe(previous);
    await user.click(previous);
    await within(dialog).findByRole('group', { name: 'Página 2 de 4' });
    await user.click(previous);
    await within(dialog).findByRole('group', { name: 'Página 1 de 4' });
    expect(previous.disabled).toBe(true);
    expect(document.activeElement).toBe(next);
  });

  it('leaves the arrows with Alt, Ctrl, Meta or Shift to the browser', async () => {
    view({ loadPage: load });
    await answered();
    const user = userEvent.setup();
    await user.click(referenceButton(FIRST));
    const dialog = screen.getByRole('dialog');
    await within(dialog).findByRole('group', { name: 'Página 3 de 4' });

    for (const modifier of ['Alt', 'Control', 'Meta', 'Shift']) {
      await user.keyboard(`{${modifier}>}{ArrowLeft}{ArrowRight}{/${modifier}}`);
    }

    expect(load).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByText('p. 3')).toBeTruthy();
  });

  it('reopens the open reference at its cited page, focus on the close control, when it is selected again', async () => {
    view({ loadPage: load });
    await answered();
    const user = userEvent.setup();
    const button = referenceButton(FIRST);
    await user.click(button);
    await within(screen.getByRole('dialog')).findByRole('group', { name: 'Página 3 de 4' });
    await user.keyboard('{ArrowRight}');
    await within(screen.getByRole('dialog')).findByRole('group', { name: 'Página 4 de 4' });

    await user.click(button);

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('p. 3')).toBeTruthy();
    expect(load).toHaveBeenLastCalledWith(TURN, 1, 3, expect.any(AbortSignal));
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Fechar a fonte' }));
    await user.keyboard('{Escape}');
    expect(document.activeElement).toBe(button);
  });

  it('closes with Esc or the close control and gives focus back to the reference', async () => {
    view({ loadPage: load });
    await answered();
    const user = userEvent.setup();
    const button = referenceButton(FIRST);
    await user.click(button);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(button);

    await user.click(button);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Fechar a fonte' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('closes with Esc while another answer runs, and the answer goes on', async () => {
    view({ loadPage: load });
    await answered();
    const user = userEvent.setup();
    const button = referenceButton(FIRST);
    postQuestion.mockResolvedValueOnce({ ok: true, turn: { id: '0190a0b0-0000-7000-8000-000000000022', conversationId: 'c', language: 'pt-BR' } });
    await user.type(composer(), 'Outra?{Enter}');
    await waitFor(() => expect(streams).toHaveLength(2));
    streams[1]!.emit('delta', { text: 'Respondendo agora' }, 1);
    expect(screen.getByRole('button', { name: 'Parar' })).toBeTruthy();

    await user.click(button);
    expect(document.activeElement).toBe(within(screen.getByRole('dialog')).getByRole('button', { name: 'Fechar a fonte' }));
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(button);
    expect(stopTurn).not.toHaveBeenCalled();
    expect(streams[1]!.closed).toBe(false);
    expect(screen.getByRole('button', { name: 'Parar' })).toBeTruthy();
  });

  it('replaces the page and the focus target when another reference is selected', async () => {
    view({ loadPage: load });
    await answered();
    const user = userEvent.setup();
    await user.click(referenceButton(FIRST));
    const second = referenceButton('Bestiário.pdf, p. 12');

    await user.click(second);

    const dialog = screen.getByRole('dialog', { name: 'Bestiário.pdf' });
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(within(dialog).getByText('p. 12')).toBeTruthy();
    expect(load).toHaveBeenLastCalledWith(TURN, 2, 12, expect.any(AbortSignal));
    await user.keyboard('{Escape}');
    expect(document.activeElement).toBe(second);
  });

  it('gives a removed reference no button', async () => {
    view({ loadPage: load });
    await answered(true);
    const items = within(screen.getAllByRole('list', { name: 'Fontes' })[0]!).getAllByRole('listitem');
    expect(within(items[1]!).queryByRole('button')).toBeNull();
    expect(items[1]!.querySelector('s')?.textContent).toBe('Bestiário.pdf, p. 12');
    expect(within(items[0]!).getByRole('button', { name: FIRST })).toBeTruthy();
  });

  it('shows the load-failure text and Tentar de novo when a page fails to load, and a retry loads the same page again', async () => {
    load.mockResolvedValueOnce(null);
    view({ loadPage: load });
    await answered();
    const user = userEvent.setup();

    await user.click(referenceButton(FIRST));

    const dialog = screen.getByRole('dialog');
    const failure = await within(dialog).findByRole('alert');
    expect(failure.textContent).toBe('Não foi possível carregar esta página.');
    expect(within(dialog).queryByText(/ilegível/)).toBeNull();
    expect(within(dialog).getByText('p. 3')).toBeTruthy();

    await user.click(within(dialog).getByRole('button', { name: 'Tentar de novo' }));

    expect(load).toHaveBeenCalledTimes(2);
    expect(load).toHaveBeenLastCalledWith(TURN, 1, 3, expect.any(AbortSignal));
    await waitFor(() => expect(dialog.querySelector('image')).not.toBeNull());
    expect(within(dialog).queryByRole('alert')).toBeNull();
    expect(within(dialog).getByRole('group', { name: 'trecho citado' })).toBeTruthy();
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('gives focus to the close control when an arrow moves the page with focus on Tentar de novo', async () => {
    load.mockResolvedValueOnce(null);
    view({ loadPage: load });
    await answered();
    const user = userEvent.setup();
    await user.click(referenceButton(FIRST));
    const dialog = screen.getByRole('dialog');
    const retry = await within(dialog).findByRole('button', { name: 'Tentar de novo' });
    retry.focus();

    await user.keyboard('{ArrowLeft}');

    await within(dialog).findByRole('group', { name: 'Página 2 de 4' });
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Fechar a fonte' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows the unopened text for an unreadable page with nothing on it, and no retry', async () => {
    load.mockResolvedValue({ page: 3, pageTotal: 4, picture: null, lines: [], text: null, passages: [], outcome: 'unreadable' });
    view({ loadPage: load });
    await answered();

    await userEvent.setup().click(referenceButton(FIRST));

    const dialog = screen.getByRole('dialog');
    await within(dialog).findByText('Esta página não pôde ser aberta. Ela consta como ilegível no relatório.');
    expect(within(dialog).queryByRole('button', { name: 'Tentar de novo' })).toBeNull();
    expect(within(dialog).queryByText('Não foi possível carregar esta página.')).toBeNull();
  });

  it('marks the cited range of a text page, and has the source view strings in English too', async () => {
    load.mockResolvedValue({
      page: 3,
      pageTotal: 3,
      picture: null,
      lines: [],
      text: '# Magias\n\nFire Bolt causa 1d10.',
      passages: [{ id: PASSAGE_A, range: [10, 31] }],
      outcome: 'read_directly',
    });
    view({ loadPage: load, language: 'en' });
    await answered();

    await userEvent.setup().click(referenceButton(FIRST));

    const dialog = screen.getByRole('dialog');
    const group = await within(dialog).findByRole('group', { name: 'cited passage' });
    expect(group.querySelector('mark')?.textContent).toBe('Fire Bolt causa 1d10.');
    expect(within(dialog).getByRole('button', { name: 'Close the source' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Previous page' })).toBeTruthy();
    expect((within(dialog).getByRole('button', { name: 'Next page' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('has the load-failure text and its retry in English too', async () => {
    load.mockResolvedValue(null);
    view({ loadPage: load, language: 'en' });
    await answered();

    await userEvent.setup().click(referenceButton(FIRST));

    const dialog = screen.getByRole('dialog');
    expect((await within(dialog).findByRole('alert')).textContent).toBe('This page could not be loaded.');
    expect(within(dialog).getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});

describe('the campaign\'s version leads (Story 3.7)', () => {
  beforeEach(() => {
    streams = [];
    postQuestion.mockReset();
    stopTurn.mockReset();
    stopTurn.mockResolvedValue(true);
    localStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  const HOUSE = 'Na mesa, 2d10.';
  const BOOK = 'No livro, 1d10.';

  /** The house rule under its campaign marker, then the book's rule under its system marker, each with its citation. */
  function disagree(stream: FakeStream, first = 1): void {
    stream.emit('tier', { tier: 'campaign', offset: 0 }, first);
    stream.emit('delta', { text: HOUSE }, first + 1);
    stream.emit('citation', { passageId: PASSAGE_A, offset: 14 }, first + 2);
    stream.emit('delta', { text: '\n\n' }, first + 3);
    stream.emit('tier', { tier: 'system', offset: 16 }, first + 4);
    stream.emit('delta', { text: BOOK }, first + 5);
    stream.emit('citation', { passageId: PASSAGE_B, offset: 31 }, first + 6);
  }

  const DISAGREE_DONE = {
    silent: false,
    references: [
      reference(1, [PASSAGE_A], { materialName: 'Notas da campanha.md', sectionPath: ['Magias'], page: 2, tier: 'campaign' }),
      reference(2, [PASSAGE_B], { page: 13, tier: 'system' }),
    ],
  };

  /** The paragraphs of the answer, each as its pills, texts and superscripts in order. */
  function answerParts(): string[][] {
    const answer = turns().getAllByRole('paragraph').filter((p) => p.closest('[class*="answer"]') !== null);
    return answer.map((paragraph) =>
      [...paragraph.childNodes].map((node) => {
        if (node.nodeName === 'SUP') {
          return `SUP:${shown(node)}`;
        }
        if (node instanceof HTMLElement && node.dataset.tier !== undefined) {
          return `PILL:${node.dataset.tier}:${node.textContent}`;
        }
        if (node instanceof HTMLElement && /separator/u.test(node.className)) {
          return `SEP:${node.textContent}`;
        }
        return `${node.nodeName}:${node.textContent}`;
      }),
    );
  }

  it('opens the house rule with a Campanha pill and the book\'s rule with a Sistema pill, each with its citation', async () => {
    view();
    const stream = await ask('Quanto dano causa Fire Bolt?');
    disagree(stream);
    // Nothing of a tier shows while the answer streams, as for the superscripts.
    expect(document.querySelector('[data-tier]')).toBeNull();

    stream.emit('done', DISAGREE_DONE, 8);

    expect(answerParts()).toEqual([
      ['PILL:campaign:Campanha', 'SEP:: ', `#text:${HOUSE}`, 'SUP:1'],
      ['PILL:system:Sistema', 'SEP:: ', `#text:${BOOK}`, 'SUP:2'],
    ]);
    // References: the campaign's, then the system's, each line opened by its tier's pill.
    const items = within(screen.getAllByRole('list', { name: 'Fontes' })[0]!).getAllByRole('listitem');
    expect(items.map((item) => item.querySelector('[data-tier]')?.textContent)).toEqual(['Campanha', 'Sistema']);
    // A visually hidden ": " keeps the word apart from the line for a reader.
    expect(items.map((item) => item.textContent)).toEqual(['Campanha: Notas da campanha.md, Magias, p. 2', 'Sistema: Livro do Jogador.pdf, Magias › Fire Bolt, p. 13']);
    // The line's button is still named by its line alone.
    expect(within(items[0]!).getByRole('button').textContent).toBe('Notas da campanha.md, Magias, p. 2');
  });

  it('draws a pill that takes no focus, has no role of its own and is read as its word', async () => {
    view();
    const stream = await ask('Quanto dano causa Fire Bolt?');
    disagree(stream);
    stream.emit('done', DISAGREE_DONE, 8);

    // Two in the answer and two on the references, plus the answer's two again in the polite region.
    const pills = [...document.querySelectorAll<HTMLElement>('[data-tier]')];
    expect(pills.length).toBe(6);
    expect(pills.filter((pill) => pill.closest('[data-testid="conversation-polite"]') === null)).toHaveLength(4);
    for (const pill of pills) {
      expect(pill.tagName).toBe('SPAN');
      expect(pill.getAttribute('tabindex')).toBeNull();
      expect(pill.getAttribute('role')).toBeNull();
      expect(pill.getAttribute('aria-hidden')).toBeNull();
      expect(pill.className).toMatch(/pill/);
    }
    // Tabbing through the answer reaches the reference buttons only, never a pill.
    const user = userEvent.setup();
    const seen: Element[] = [];
    for (let i = 0; i < 12; i++) {
      await user.tab();
      if (document.activeElement !== null) {
        seen.push(document.activeElement);
      }
    }
    expect(seen.some((element) => element.hasAttribute('data-tier'))).toBe(false);
    expect(seen.some((element) => element.textContent === 'Notas da campanha.md, Magias, p. 2')).toBe(true);
  });

  it('shows no inline pill when only one tier speaks, and each reference still carries its tier', async () => {
    view();
    const stream = await ask('Quanto dano causa Fire Bolt?');
    stream.emit('delta', { text: 'Fire Bolt causa 1d10.' });
    stream.emit('citation', { passageId: PASSAGE_A, offset: 21 });
    stream.emit('done', { silent: false, references: [reference(1, [PASSAGE_A], { tier: 'system' })] });

    expect(turns().getAllByRole('paragraph').some((p) => p.querySelector('[data-tier]') !== null && p.closest('ol') === null)).toBe(false);
    const item = within(screen.getAllByRole('list', { name: 'Fontes' })[0]!).getByRole('listitem');
    expect(item.querySelector('[data-tier]')?.textContent).toBe('Sistema');
  });

  it('shows Outros for an other-tier reference, and no pill for a reference stored before tiers, which still opens', async () => {
    const loadPage = vi.fn<LoadPage>().mockResolvedValue({ page: 3, pageTotal: 3, picture: null, lines: [], text: 'Fire Bolt.', passages: [], outcome: 'read_directly' });
    view({ loadPage });
    const stream = await ask('Quanto dano causa Fire Bolt?');
    stream.emit('delta', { text: 'Um. Dois.' });
    stream.emit('citation', { passageId: PASSAGE_A, offset: 3 });
    stream.emit('citation', { passageId: PASSAGE_B, offset: 9 });
    stream.emit('done', { silent: false, references: [reference(1, [PASSAGE_A], { tier: 'other' }), reference(2, [PASSAGE_B])] });

    const items = within(screen.getAllByRole('list', { name: 'Fontes' })[0]!).getAllByRole('listitem');
    expect(items[0]!.querySelector('[data-tier]')?.textContent).toBe('Outros');
    expect(items[1]!.querySelector('[data-tier]')).toBeNull();
    expect(items[1]!.textContent).toBe('Livro do Jogador.pdf, Magias › Fire Bolt, p. 3');
    fireEvent.click(within(items[1]!).getByRole('button'));
    await waitFor(() => expect(loadPage).toHaveBeenCalled());
    expect(loadPage.mock.calls[0]!.slice(0, 2)).toEqual([TURN, 2]);
  });

  it('keeps a removed source\'s stored tier beside "fonte removida"', async () => {
    view();
    const stream = await ask('Quanto dano causa Fire Bolt?');
    stream.emit('delta', { text: 'Um.' });
    stream.emit('citation', { passageId: PASSAGE_A, offset: 3 });
    stream.emit('done', { silent: false, references: [reference(1, [PASSAGE_A], { tier: 'campaign', removed: true })] });

    const item = within(screen.getAllByRole('list', { name: 'Fontes' })[0]!).getByRole('listitem');
    expect(item.textContent).toBe('Campanha: Livro do Jogador.pdf, Magias › Fire Bolt, p. 3 — fonte removida');
  });

  it('ignores a tier event that is not one, and leaves out a reference with an unknown tier', async () => {
    view();
    const stream = await ask('Quanto dano causa Fire Bolt?');
    stream.emit('tier', { tier: 'xyz', offset: 0 });
    stream.emit('tier', { tier: 'campaign', offset: -1 });
    stream.emit('tier', { tier: 'campaign' });
    stream.emit('delta', { text: 'Um. Dois.' });
    stream.emit('citation', { passageId: PASSAGE_A, offset: 3 });
    stream.emit('citation', { passageId: PASSAGE_B, offset: 9 });
    stream.emit('done', { silent: false, references: [reference(1, [PASSAGE_A], { tier: 'model' }), reference(2, [PASSAGE_B], { tier: 'system' })] });

    expect(document.querySelectorAll('p [data-tier]')).toHaveLength(0);
    const items = within(screen.getAllByRole('list', { name: 'Fontes' })[0]!).getAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(items[0]!.getAttribute('value')).toBe('2');
  });

  it('puts the pills at the same places after a reconnection mid-answer replays from the last event', async () => {
    view();
    const stream = await ask('Quanto dano causa Fire Bolt?');
    stream.emit('tier', { tier: 'campaign', offset: 0 }, 1);
    stream.emit('delta', { text: HOUSE }, 2);
    vi.useFakeTimers();
    stream.drop();
    act(() => vi.advanceTimersByTime(RECONNECT_GIVE_UP_MS));
    fireEvent.click(turns().getByRole('button', { name: 'Tentar de novo' }));
    expect(streams[1]!.url).toBe(`/api/v1/turns/${TURN}/events?lastEventId=2`);
    vi.useRealTimers();
    streams[1]!.open();
    // The backend replays from the last id; anything repeated is ignored, so the campaign pill is drawn once.
    streams[1]!.emit('tier', { tier: 'campaign', offset: 0 }, 1);
    streams[1]!.emit('citation', { passageId: PASSAGE_A, offset: 14 }, 3);
    streams[1]!.emit('delta', { text: '\n\n' }, 4);
    streams[1]!.emit('tier', { tier: 'system', offset: 16 }, 5);
    streams[1]!.emit('delta', { text: BOOK }, 6);
    streams[1]!.emit('citation', { passageId: PASSAGE_B, offset: 31 }, 7);
    streams[1]!.emit('done', DISAGREE_DONE, 8);

    expect(answerParts()).toEqual([
      ['PILL:campaign:Campanha', 'SEP:: ', `#text:${HOUSE}`, 'SUP:1'],
      ['PILL:system:Sistema', 'SEP:: ', `#text:${BOOK}`, 'SUP:2'],
    ]);
  });

  it('says the tiers in the polite region: each version after its word, each reference line after its tier', async () => {
    view();
    const stream = await ask('Quanto dano causa Fire Bolt?');
    disagree(stream);
    stream.emit('done', DISAGREE_DONE, 8);

    const region = screen.getByTestId('conversation-polite');
    expect([...region.querySelectorAll('p')].map((p) => p.textContent)).toEqual([`Campanha: ${HOUSE}`, `Sistema: ${BOOK}`]);
    expect([...region.querySelectorAll('li')].map((item) => item.textContent)).toEqual([
      'Campanha: Notas da campanha.md, Magias, p. 2',
      'Sistema: Livro do Jogador.pdf, Magias › Fire Bolt, p. 13',
    ]);
  });

  it('draws no inline pill for a lone marker, and one pill for a tier marked twice in a row', async () => {
    view();
    const stream = await ask('Quanto dano causa Fire Bolt?');
    stream.emit('tier', { tier: 'system', offset: 0 }, 1);
    stream.emit('delta', { text: BOOK }, 2);
    stream.emit('citation', { passageId: PASSAGE_B, offset: 15 }, 3);
    stream.emit('done', { silent: false, references: [reference(1, [PASSAGE_B], { tier: 'system' })] }, 4);

    expect(document.querySelectorAll('main p span[data-tier], [class*="answer"] span[data-tier]')).toHaveLength(0);
    expect(answerParts()).toEqual([[`#text:${BOOK}`, 'SUP:1']]);
    // Reference pills stay as they are.
    expect(within(screen.getAllByRole('list', { name: 'Fontes' })[0]!).getByRole('listitem').querySelector('[data-tier]')?.textContent).toBe('Sistema');

    cleanup();
    streams = [];
    view();
    const repeated = await ask('Quanto dano causa Fire Bolt?');
    repeated.emit('tier', { tier: 'campaign', offset: 0 }, 1);
    repeated.emit('delta', { text: 'Um.\n\n' }, 2);
    repeated.emit('tier', { tier: 'campaign', offset: 5 }, 3);
    repeated.emit('delta', { text: 'Dois.\n\n' }, 4);
    repeated.emit('tier', { tier: 'system', offset: 12 }, 5);
    repeated.emit('delta', { text: 'Três.' }, 6);
    repeated.emit('done', { silent: false, references: [reference(1, [PASSAGE_A], { tier: 'campaign' })] }, 7);

    expect(answerParts()).toEqual([
      ['PILL:campaign:Campanha', 'SEP:: ', '#text:Um.'],
      ['#text:Dois.'],
      ['PILL:system:Sistema', 'SEP:: ', '#text:Três.'],
    ]);
  });

  it('keeps both pills at their places in a stopped answer', async () => {
    view();
    const stream = await ask('Quanto dano causa Fire Bolt?');
    disagree(stream);
    stream.emit('done', { stopped: true, silent: false, references: DISAGREE_DONE.references }, 8);

    expect(turns().getByText('Interrompida')).toBeTruthy();
    expect(answerParts()).toEqual([
      ['PILL:campaign:Campanha', 'SEP:: ', `#text:${HOUSE}`, 'SUP:1'],
      ['PILL:system:Sistema', 'SEP:: ', `#text:${BOOK}`, 'SUP:2'],
    ]);
  });

  it('names the tiers in English with an English interface', async () => {
    view({ language: 'en' });
    const stream = await ask('How much damage?', 'en');
    disagree(stream);
    stream.emit('done', DISAGREE_DONE, 8);

    const shownPills = [...document.querySelectorAll('[data-tier]')].filter((pill) => pill.closest('[data-testid="conversation-polite"]') === null);
    expect(shownPills.map((pill) => pill.textContent)).toEqual(['Campaign', 'System', 'Campaign', 'System']);
  });
});

describe('model knowledge only when I turn it on (Story 3.8)', () => {

  beforeEach(() => {
    streams = [];
    postQuestion.mockReset();
    stopTurn.mockReset();
    stopTurn.mockResolvedValue(true);
    localStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  const SCOPE = { version: 1, campaignTier: true, systemTier: true, otherTier: false, modelKnowledge: false, materials: [] };

  /** The conversation inside the shell's scope popover provider, with the context bar's popover beside it. */
  function viewWithPopover(language: 'pt-BR' | 'en' = 'pt-BR') {
    return render(
      <ScopePopoverProvider>
        <ScopePopover
          summary="Campanha + Sistema · conhecimento do modelo desligado"
          label="Escopo"
          panel="Escopo da campanha"
          campaignId={CAMPAIGN}
          scope={SCOPE}
          language={language}
          action={vi.fn(async () => ({ scope: null, error: null, saved: false }))}
        />
        <UploadsProvider texts={uploadTexts(language)} belonging={NO_PLACES} urlStorage={memoryStorage()}>
          <Conversation
            language={language}
            campaignId={CAMPAIGN}
            hasSources
            review={null}
            openStream={(url) => {
              const stream = new FakeStream(url);
              streams.push(stream);
              return stream as unknown as EventSource;
            }}
          />
        </UploadsProvider>
      </ScopePopoverProvider>,
    );
  }

  /** The answer's blocks, each as its pills (with what a reader hears for them), texts and superscripts in order. */
  function blocks(): string[][] {
    const answer = turns().getAllByRole('paragraph').filter((p) => p.closest('[class*="answer"]') !== null);
    return answer.map((paragraph) => {
      if (/modelEnd/u.test(paragraph.className)) {
        return [`END:${paragraph.textContent}`];
      }
      return [...paragraph.childNodes].map((node) => {
        if (node.nodeName === 'SUP') {
          return `SUP:${shown(node)}`;
        }
        if (node instanceof HTMLElement && node.dataset.tier !== undefined) {
          return `PILL:${node.dataset.tier}:${node.textContent}${node.getAttribute('aria-hidden') === 'true' ? ':hidden' : ''}`;
        }
        if (node instanceof HTMLElement && /separator/u.test(node.className)) {
          return `SEP:${node.textContent}`;
        }
        return `${node.nodeName}:${node.textContent}`;
      });
    });
  }

  it('matrix row "On, mixed": citations as before, and the model paragraph opens with its pill and closes with its line', async () => {
    view();
    const stream = await ask('Quanto dano causa Fire Bolt?');
    stream.emit('delta', { text: 'Na mesa, 2d10.' }, 1);
    stream.emit('citation', { passageId: PASSAGE_A, offset: 14 }, 2);
    stream.emit('delta', { text: '\n\n' }, 3);
    stream.emit('tier', { tier: 'model', offset: 16 }, 4);
    stream.emit('delta', { text: 'Em geral, 1d10.' }, 5);
    // Nothing of it shows while the answer streams.
    expect(document.querySelector('[data-tier]')).toBeNull();
    stream.emit('done', { silent: false, modelKnowledge: true, references: [reference(1, [PASSAGE_A], { tier: 'campaign' })] }, 6);

    // The model pill is drawn alone (the 3.7 rule of two tiers is for the scope's tiers only); it has no superscript.
    expect(blocks()).toEqual([
      ['#text:Na mesa, 2d10.', 'SUP:1'],
      ['PILL:model:Conhecimento do modelo:hidden', 'SEP:Do conhecimento do modelo, sem fonte. ', '#text:Em geral, 1d10.'],
      ['END:Do conhecimento do modelo, sem fonte.'],
    ]);
    expect(screen.queryByTestId('silent-offer')).toBeNull();
    // A reader hears the sentence for the pill, never the word shown.
    const polite = screen.getByTestId('conversation-polite');
    expect(polite.textContent).toContain('Do conhecimento do modelo, sem fonte. Em geral, 1d10.');
    // Neither the pill nor the line takes focus or has a role.
    for (const element of document.querySelectorAll<HTMLElement>('[data-tier="model"], [class*="modelEnd"]')) {
      expect(element.getAttribute('tabindex')).toBeNull();
      expect(element.getAttribute('role')).toBeNull();
    }
  });

  it('closes the model part before the next tier\'s pill, and draws the scope\'s tiers only when two of them disagree', async () => {
    view();
    const stream = await ask('How much?');
    stream.emit('tier', { tier: 'campaign', offset: 0 }, 1);
    stream.emit('delta', { text: 'At the table, 2d10.' }, 2);
    stream.emit('citation', { passageId: PASSAGE_A, offset: 19 }, 3);
    stream.emit('delta', { text: '\n\n' }, 4);
    stream.emit('tier', { tier: 'model', offset: 21 }, 5);
    stream.emit('delta', { text: 'Usually 1d10.\n\n' }, 6);
    stream.emit('tier', { tier: 'system', offset: 36 }, 7);
    stream.emit('delta', { text: 'In the book, 1d10.' }, 8);
    stream.emit('citation', { passageId: PASSAGE_B, offset: 54 }, 9);
    stream.emit('done', {
      silent: false,
      modelKnowledge: true,
      references: [reference(1, [PASSAGE_A], { tier: 'campaign' }), reference(2, [PASSAGE_B], { tier: 'system' })],
    }, 10);

    expect(blocks()).toEqual([
      ['PILL:campaign:Campanha', 'SEP:: ', '#text:At the table, 2d10.', 'SUP:1'],
      ['PILL:model:Conhecimento do modelo:hidden', 'SEP:Do conhecimento do modelo, sem fonte. ', '#text:Usually 1d10.'],
      ['END:Do conhecimento do modelo, sem fonte.'],
      ['PILL:system:Sistema', 'SEP:: ', '#text:In the book, 1d10.', 'SUP:2'],
    ]);
  });

  it('matrix row "On, nothing handed": only the model paragraph, with its pill, is not silent and has no reference', async () => {
    view({ language: 'en' });
    const stream = await ask('How much?', 'en');
    stream.emit('tier', { tier: 'model', offset: 0 }, 1);
    stream.emit('delta', { text: 'Usually 1d10.' }, 2);
    stream.emit('done', { silent: false, modelKnowledge: true, references: [] }, 3);

    expect(blocks()).toEqual([
      ['PILL:model:Model knowledge:hidden', 'SEP:From model knowledge, no source. ', '#text:Usually 1d10.'],
      ['END:From model knowledge, no source.'],
    ]);
    expect(turns().queryByText('The sources say nothing about this.')).toBeNull();
    expect(screen.queryAllByRole('list', { name: 'Sources' })).toHaveLength(0);
    expect(screen.queryByTestId('silent-offer')).toBeNull();
  });

  it('keeps a model part even when the done event carries no reference and does not say silent', async () => {
    view();
    const stream = await ask('Quanto?');
    stream.emit('tier', { tier: 'model', offset: 0 }, 1);
    stream.emit('delta', { text: 'Em geral, 1d10.' }, 2);
    // An old backend's done with no modelKnowledge: the marked part still stays.
    stream.emit('done', { silent: false, references: [] }, 3);

    expect(turns().getByText('Em geral, 1d10.')).toBeTruthy();
    expect(turns().queryByText('As fontes não dizem nada sobre isso.')).toBeNull();
  });

  it('matrix row "On, silent": the silent sentence and no offer when the turn had model knowledge on', async () => {
    viewWithPopover();
    const stream = await ask('Quanto?');
    stream.emit('done', { silent: true, modelKnowledge: true, references: [] }, 1);

    expect(turns().getByText('As fontes não dizem nada sobre isso.')).toBeTruthy();
    expect(screen.queryByTestId('silent-offer')).toBeNull();
    expect(polite()).toBe('As fontes não dizem nada sobre isso.');
  });

  it('matrix row "Off, silent": the offer line under the silent sentence, said too, opens the scope popover', async () => {
    viewWithPopover();
    const stream = await ask('Quanto?');
    stream.emit('delta', { text: 'Texto sem fonte.' }, 1);
    stream.emit('done', { silent: true, modelKnowledge: false, references: [] }, 2);

    const offer = screen.getByTestId('silent-offer');
    expect(offer.textContent).toBe('Ampliar as fontes ou ligar o conhecimento do modeloAbrir o escopo');
    expect(offer.closest('li')).not.toBeNull();
    expect(polite()).toBe('As fontes não dizem nada sobre isso. Ampliar as fontes ou ligar o conhecimento do modelo.');
    const trigger = screen.getByRole('button', { name: /^Escopo:/u });
    const group = document.getElementById(trigger.getAttribute('aria-controls')!)!;
    expect(group.hidden).toBe(true);

    await userEvent.setup().click(within(offer).getByRole('button', { name: 'Abrir o escopo' }));

    expect(group.hidden).toBe(false);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    await waitFor(() => expect(group.contains(document.activeElement)).toBe(true));
  });

  it('opens the popover from the keyboard with focus inside it (en)', async () => {
    viewWithPopover('en');
    const stream = await ask('How much?', 'en');
    stream.emit('done', { silent: true, modelKnowledge: false, references: [] }, 1);

    const button = within(screen.getByTestId('silent-offer')).getByRole('button', { name: 'Open the scope' });
    expect(screen.getByTestId('silent-offer').textContent).toBe('Widen the sources or turn on model knowledgeOpen the scope');
    button.focus();
    await userEvent.setup().keyboard('{Enter}');

    const group = screen.getByRole('group', { name: 'Escopo da campanha' });
    await waitFor(() => expect(group.contains(document.activeElement)).toBe(true));
    expect(document.activeElement?.getAttribute('role')).toBe('switch');
    // Esc closes it and gives focus back to the offer's button (the summary is hidden under 768px).
    await userEvent.setup().keyboard('{Escape}');
    expect(group.hidden).toBe(true);
    await waitFor(() => expect(document.activeElement).toBe(button));
  });

  it('shows the offer without its button where no scope popover is there to open', async () => {
    view();
    const stream = await ask('Quanto?');
    stream.emit('done', { silent: true, references: [] }, 1);

    const offer = screen.getByTestId('silent-offer');
    expect(offer.textContent).toBe('Ampliar as fontes ou ligar o conhecimento do modelo');
    expect(within(offer).queryByRole('button')).toBeNull();
  });

  it('matrix row "Replay": the model pill stays at its place after a reconnection replays from the last event', async () => {
    view();
    const stream = await ask('Quanto?');
    stream.emit('delta', { text: 'Na mesa, 2d10.' }, 1);
    stream.emit('citation', { passageId: PASSAGE_A, offset: 14 }, 2);
    stream.emit('delta', { text: '\n\n' }, 3);
    stream.emit('tier', { tier: 'model', offset: 16 }, 4);
    vi.useFakeTimers();
    stream.drop();
    act(() => vi.advanceTimersByTime(RECONNECT_GIVE_UP_MS));
    fireEvent.click(turns().getByRole('button', { name: 'Tentar de novo' }));
    expect(streams[1]!.url).toBe(`/api/v1/turns/${TURN}/events?lastEventId=4`);
    vi.useRealTimers();
    streams[1]!.open();
    // The backend replays from the last id; a repeated marker is ignored, so the model pill is drawn once.
    streams[1]!.emit('tier', { tier: 'model', offset: 16 }, 4);
    streams[1]!.emit('delta', { text: 'Em geral, 1d10.' }, 5);
    streams[1]!.emit('done', { silent: false, modelKnowledge: true, references: [reference(1, [PASSAGE_A])] }, 6);

    expect(blocks()).toEqual([
      ['#text:Na mesa, 2d10.', 'SUP:1'],
      ['PILL:model:Conhecimento do modelo:hidden', 'SEP:Do conhecimento do modelo, sem fonte. ', '#text:Em geral, 1d10.'],
      ['END:Do conhecimento do modelo, sem fonte.'],
    ]);
  });
});

describe('conversations by area (Story 3.10)', () => {
  const CONVERSATION = '0190a0b0-0000-7000-8000-000000000020';
  type Stored = import('@/client/conversation').StoredTurn;
  const stored = (
    id: string,
    question: string,
    events: [string, unknown][],
    language: Stored['language'] = 'pt-BR',
    bookmarked = false,
  ): Stored => ({
    id,
    question,
    language,
    createdAt: '2026-11-22T12:00:00Z',
    events: events.map(([type, data], index) => ({ sequence: index + 1, type, data })) as Stored['events'],
    bookmarked,
  });

  type DeleteAction = NonNullable<import('@/components/conversation/Conversation').ConversationProps['deleteAction']>;
  function opened(
    props: {
      area?: 'questions' | 'rules';
      conversationId?: string | null;
      name?: string | null;
      stored?: readonly Stored[];
      questions?: number | null;
      deleteAction?: DeleteAction;
      focusTurn?: string | null;
      language?: 'pt-BR' | 'en';
      around?: (children: ReactNode) => ReactNode;
    } = {},
  ) {
    const around = props.around ?? ((children: ReactNode) => children);
    return render(
      around(
        <UploadsProvider texts={uploadTexts('pt-BR')} belonging={NO_PLACES} urlStorage={memoryStorage()}>
          <Conversation
            language={props.language ?? 'pt-BR'}
            campaignId={CAMPAIGN}
            hasSources
            review={null}
            area={props.area}
            conversationId={props.conversationId}
            name={props.name}
            stored={props.stored}
            questions={props.questions}
            deleteAction={props.deleteAction}
            focusTurn={props.focusTurn}
            openStream={(url) => {
              const stream = new FakeStream(url);
              streams.push(stream);
              return stream as unknown as EventSource;
            }}
          />
        </UploadsProvider>,
      ),
    );
  }

  beforeAll(() => {
    // jsdom has no modal dialogs: the smallest stand-in for showModal() and close() (Story 3.10 part B's "Excluir").
    if (typeof HTMLDialogElement.prototype.showModal !== 'function') {
      HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
        this.setAttribute('open', '');
      };
      HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
        this.removeAttribute('open');
        this.dispatchEvent(new Event('close'));
      };
    }
  });

  beforeEach(() => {
    streams = [];
    postQuestion.mockReset();
    stopTurn.mockReset();
    setDismissal.mockReset();
    setBookmark.mockReset();
    localStorage.clear();
    window.history.replaceState(null, '', '/questions/new');
  });
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it('matrix: a new conversation opens with the composer focused and three area examples, which fill it and never send', async () => {
    opened({ area: 'rules' });
    expect(document.activeElement).toBe(composer());
    expect(screen.getByText('Que regra você quer criar?')).toBeTruthy();
    const examples = within(screen.getByRole('list', { name: 'Exemplos de perguntas' })).getAllByRole('button');
    expect(examples.map((button) => button.textContent)).toEqual([
      'Que regras já existem sobre fabricar itens?',
      'Como o sistema define a dificuldade de um teste?',
      'Quais regras da casa esta campanha tem?',
    ]);
    // The way back only: a new conversation has no name and no "Renomear" yet.
    const top = screen.getByTestId('conversation-top');
    expect(within(top).getByRole('link', { name: 'Criação de Regras' }).getAttribute('href')).toBe('/rules');
    expect(within(top).queryByRole('link', { name: 'Renomear' })).toBeNull();

    const user = userEvent.setup();
    await user.click(examples[1]!);

    expect(composer().value).toBe('Como o sistema define a dificuldade de um teste?');
    expect(document.activeElement).toBe(composer());
    expect(composer().selectionStart).toBe(composer().value.length);
    expect(postQuestion).not.toHaveBeenCalled();
    expect(localStorage.getItem(`${DRAFT_PREFIX}${CAMPAIGN}:new:rules`)).toBe('Como o sistema define a dificuldade de um teste?');
  });

  it('matrix row "First question in a new conversation": asked in its area, then the address and the slim line name it', async () => {
    opened({ area: 'rules' });
    postQuestion.mockResolvedValueOnce({ ok: true, turn: { id: TURN, conversationId: CONVERSATION, language: 'pt-BR' } });
    const user = userEvent.setup();
    await user.type(composer(), 'Que regras já existem sobre fabricar itens mágicos de alto nível em campanhas longas?{Enter}');

    expect(postQuestion).toHaveBeenCalledWith(CAMPAIGN, 'Que regras já existem sobre fabricar itens mágicos de alto nível em campanhas longas?', { area: 'rules' });
    await waitFor(() => expect(window.location.pathname).toBe(`/rules/${CONVERSATION}`));
    const top = screen.getByTestId('conversation-top');
    // The default name, as the backend gives it: the first 60 code points, cut at a word boundary.
    expect(within(top).getByText('Que regras já existem sobre fabricar itens mágicos de alto')).toBeTruthy();
    expect(within(top).getByRole('link', { name: 'Renomear' }).getAttribute('href')).toBe(`/rules/${CONVERSATION}/edit`);
    expect(screen.queryByRole('list', { name: 'Exemplos de perguntas' })).toBeNull();

    // Matrix row "Continue": the next question names the conversation.
    streams[0]!.emit('done', { stopped: false, silent: true, modelKnowledge: false, references: [] }, 1);
    postQuestion.mockResolvedValueOnce({ ok: true, turn: { id: TURN, conversationId: CONVERSATION, language: 'pt-BR' } });
    await user.type(composer(), 'E itens comuns?{Enter}');
    expect(postQuestion).toHaveBeenLastCalledWith(CAMPAIGN, 'E itens comuns?', { conversationId: CONVERSATION });
  });

  it('matrix: a reopened conversation shows its turns with their references, and the next question continues it', async () => {
    const done = { stopped: false, silent: false, modelKnowledge: false, references: [reference(1, [PASSAGE_A])] };
    opened({
      conversationId: CONVERSATION,
      name: 'Fire Bolt',
      stored: [
        stored(TURN, 'Quanto dano causa Fire Bolt?', [
          ['delta', { text: 'Fire Bolt causa 1d10.' }],
          ['citation', { passageId: PASSAGE_A, offset: 21 }],
          ['done', done],
        ]),
        stored(PASSAGE_B, 'E se eu parar?', [['delta', { text: 'Começo' }], ['done', { ...done, stopped: true, references: [] }]]),
        stored(PASSAGE_C, 'E agora?', [['delta', { text: 'Metade' }], ['error', { code: 'model.unavailable' }]]),
      ],
    });

    expect(turns().getByText('Quanto dano causa Fire Bolt?')).toBeTruthy();
    expect(superscripts()).toEqual(['1']);
    expect(turns().getByText(/Livro do Jogador\.pdf/)).toBeTruthy();
    expect(turns().getByText('Começo')).toBeTruthy();
    expect(turns().getByText('Interrompida')).toBeTruthy();
    // A failed turn shows its failure in place of what streamed, with "Tentar de novo".
    expect(turns().queryByText('Metade')).toBeNull();
    expect(turns().getByText('O serviço de IA está indisponível agora.')).toBeTruthy();
    expect(screen.queryByTestId('conversation-intro')).toBeNull();
    expect(within(screen.getByTestId('conversation-top')).getByText('Fire Bolt')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Fire Bolt');
    // Nothing streams for turns that have ended, and the composer is not taken from the reader.
    expect(streams).toHaveLength(0);
    expect(document.activeElement).not.toBe(composer());

    postQuestion.mockResolvedValueOnce({ ok: true, turn: { id: TURN, conversationId: CONVERSATION, language: 'pt-BR' } });
    const user = userEvent.setup();
    await user.type(composer(), 'E Fireball?{Enter}');
    expect(postQuestion).toHaveBeenCalledWith(CAMPAIGN, 'E Fireball?', { conversationId: CONVERSATION });
    expect(window.location.pathname).toBe('/questions/new');
  });

  it('follows a stored turn still being written from its last event, keeping what it already has', async () => {
    opened({
      conversationId: CONVERSATION,
      name: 'Fire Bolt',
      stored: [stored(TURN, 'Quanto dano?', [['delta', { text: 'Fire Bolt causa ' }], ['citation', { passageId: PASSAGE_A, offset: 16 }]])],
    });

    await waitFor(() => expect(streams).toHaveLength(1));
    expect(streams[0]!.url).toBe(`/api/v1/turns/${TURN}/events?lastEventId=2`);
    expect(turns().getByText('Fire Bolt causa')).toBeTruthy();
    // While it runs, the send button is Stop.
    expect(screen.getByRole('button', { name: 'Parar' })).toBeTruthy();
    streams[0]!.emit('delta', { text: '1d10.' }, 3);
    streams[0]!.emit('done', { stopped: false, silent: false, modelKnowledge: false, references: [reference(1, [PASSAGE_A])] }, 4);

    expect(turns().getByText(/Fire Bolt causa\s*1d10\./)).toBeTruthy();
    expect(superscripts()).toEqual(['1']);
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeTruthy();
  });

  it('keeps the draft of an opened conversation apart from a new one\'s', async () => {
    localStorage.setItem(`${DRAFT_PREFIX}${CAMPAIGN}:new:questions`, 'Rascunho novo');
    localStorage.setItem(`${DRAFT_PREFIX}${CAMPAIGN}:${CONVERSATION}`, 'Rascunho da conversa');
    opened({ conversationId: CONVERSATION, name: 'Fire Bolt', stored: [] });
    await waitFor(() => expect(composer().value).toBe('Rascunho da conversa'));
  });

  // --- Story 3.10 part B: delete a conversation

  it('"Excluir" follows "Renomear" in the slim line, outlined in danger; its dialog names the questions read with the page plus those asked since', async () => {
    const deleteAction = vi.fn<DeleteAction>(async () => ({ error: null }));
    opened({ conversationId: CONVERSATION, name: 'Fire Bolt', stored: [], questions: 2, deleteAction });
    const top = screen.getByTestId('conversation-top');
    const rename = within(top).getByRole('link', { name: 'Renomear' });
    const pill = within(top).getByRole('button', { name: 'Excluir' });
    expect(pill.dataset.variant).toBe('danger');
    expect(rename.compareDocumentPosition(pill) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const user = userEvent.setup();
    await user.click(pill);
    const dialog = screen.getByRole('dialog', { name: 'Excluir esta conversa?' });
    expect(dialog.textContent).toContain('Vão junto: 2 perguntas e suas respostas. Isso não pode ser desfeito.');
    // Focus starts on Cancelar.
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Cancelar' }));
    await user.keyboard('{Escape}');

    // A question asked on the page goes too: the count follows.
    postQuestion.mockResolvedValueOnce({ ok: true, turn: { id: TURN, conversationId: CONVERSATION, language: 'pt-BR' } });
    await user.type(composer(), 'E Fireball?{Enter}');
    await waitFor(() => expect(streams).toHaveLength(1));
    streams[0]!.emit('done', { stopped: false, silent: true, modelKnowledge: false, references: [] }, 1);
    await user.click(within(top).getByRole('button', { name: 'Excluir' }));
    expect(screen.getByRole('dialog').textContent).toContain('Vão junto: 3 perguntas e suas respostas.');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Excluir conversa' }));
    await waitFor(() => expect(deleteAction).toHaveBeenCalledTimes(1));
    expect((deleteAction.mock.calls[0]![1] as FormData).get('id')).toBe(CONVERSATION);
  });

  it('a conversation made on the page has "Excluir" once it has an id, its dialog in words; a new one has none', async () => {
    const deleteAction = vi.fn<DeleteAction>(async () => ({ error: 'Não encontrado.' }));
    opened({ area: 'rules', deleteAction });
    expect(within(screen.getByTestId('conversation-top')).queryByRole('button', { name: 'Excluir' })).toBeNull();

    postQuestion.mockResolvedValueOnce({ ok: true, turn: { id: TURN, conversationId: CONVERSATION, language: 'pt-BR' } });
    const user = userEvent.setup();
    await user.type(composer(), 'Que regras existem?{Enter}');
    const pill = await within(screen.getByTestId('conversation-top')).findByRole('button', { name: 'Excluir' });
    await user.click(pill);
    expect(screen.getByRole('dialog').textContent).toContain(
      'Vão junto: as perguntas desta conversa e suas respostas. Isso não pode ser desfeito.',
    );
    // A refusal shows under the pill, and focus is back on it.
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Excluir conversa' }));
    expect((await within(screen.getByTestId('conversation-top')).findByRole('alert')).textContent).toBe('Não encontrado.');
    expect(document.activeElement).toBe(pill);
  });

  it('offers no "Excluir" without its Server Action', () => {
    opened({ conversationId: CONVERSATION, name: 'Fire Bolt', stored: [], questions: 1 });
    expect(within(screen.getByTestId('conversation-top')).queryByRole('button', { name: 'Excluir' })).toBeNull();
  });

  // --- Story 3.11: dismiss an answer

  const DONE = { stopped: false, silent: false, modelKnowledge: false, references: [reference(1, [PASSAGE_A])] };
  const SECOND = '0190a0b0-0000-7000-8000-000000000022';
  const THIRD = '0190a0b0-0000-7000-8000-000000000023';

  /** A conversation of two done turns, the first cited, as the page reads it with its question count. */
  function twoDone(deleteAction?: DeleteAction) {
    return opened({
      conversationId: CONVERSATION,
      name: 'Fire Bolt',
      questions: 2,
      deleteAction,
      stored: [
        stored(TURN, 'Quanto dano causa Fire Bolt?', [
          ['delta', { text: 'Fire Bolt causa 1d10.' }],
          ['citation', { passageId: PASSAGE_A, offset: 21 }],
          ['done', DONE],
        ]),
        stored(SECOND, 'E Fireball?', [['delta', { text: 'Fireball causa 8d6.' }], ['done', { ...DONE, references: [], silent: true }]]),
      ],
    });
  }

  /** Lets the dismissal's and the undo's promises settle. */
  async function settle() {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  function dismissButtons() {
    return turns().queryAllByRole('button', { name: 'Dispensar resposta' });
  }

  it('a done and a stopped answer have "Dispensar resposta" under their rule; a failed one and one being written have none', async () => {
    opened({
      conversationId: CONVERSATION,
      name: 'Fire Bolt',
      stored: [
        stored(TURN, 'Quanto dano?', [['delta', { text: 'Fire Bolt causa 1d10.' }], ['done', DONE]]),
        stored(SECOND, 'E se eu parar?', [['delta', { text: 'Começo' }], ['done', { ...DONE, stopped: true, references: [] }]]),
        stored(THIRD, 'E agora?', [['delta', { text: 'Metade' }], ['error', { code: 'model.unavailable' }]]),
        stored(PASSAGE_C, 'E depois?', [['delta', { text: 'Escrevendo' }]]),
      ],
    });
    await waitFor(() => expect(streams).toHaveLength(1));

    const items = turns().getAllByRole('listitem').filter((item) => item.parentElement === screen.getAllByRole('list')[0]);
    expect(items).toHaveLength(4);
    for (const item of items.slice(0, 2)) {
      const button = within(item).getByRole('button', { name: 'Dispensar resposta' });
      // Under the rule, as the last control of the turn, with the X drawn inside a circle.
      const rule = item.querySelector('hr')!;
      expect(rule.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(button.querySelector('span svg path')).not.toBeNull();
    }
    expect(within(items[2]!).queryByRole('button', { name: 'Dispensar resposta' })).toBeNull();
    expect(within(items[3]!).queryByRole('button', { name: 'Dispensar resposta' })).toBeNull();

    // Once the answer being written is done, it has one too.
    streams[0]!.emit('done', DONE, 2);
    expect(within(items[3]!).getByRole('button', { name: 'Dispensar resposta' })).toBeTruthy();
    expect(dismissButtons()).toHaveLength(3);
  });

  it('dismiss: the line replaces the turn at once with focus on "Desfazer"; after 10 s it goes and focus moves to the composer', async () => {
    setDismissal.mockResolvedValue({ ok: true });
    const deleteAction = vi.fn<DeleteAction>(async () => ({ error: null }));
    twoDone(deleteAction);
    vi.useFakeTimers();

    fireEvent.click(dismissButtons()[0]!);

    expect(turns().queryByText('Quanto dano causa Fire Bolt?')).toBeNull();
    expect(turns().queryByText(/Fire Bolt causa/)).toBeNull();
    const line = screen.getByTestId('dismissed-line');
    expect(line.textContent).toBe('Resposta dispensada.Desfazer');
    const undo = within(line).getByRole('button', { name: 'Desfazer' });
    expect(document.activeElement).toBe(undo);
    expect(polite()).toContain('Resposta dispensada.');
    expect(setDismissal).toHaveBeenCalledWith(TURN, 'dismiss');
    // The other turn stays.
    expect(turns().getByText('E Fireball?')).toBeTruthy();
    await settle();

    act(() => vi.advanceTimersByTime(UNDO_MS - 1));
    expect(screen.queryByTestId('dismissed-line')).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByTestId('dismissed-line')).toBeNull();
    expect(turns().queryByText('Quanto dano causa Fire Bolt?')).toBeNull();
    expect(document.activeElement).toBe(composer());
    expect(setDismissal).toHaveBeenCalledTimes(1);
    vi.useRealTimers();

    // The delete dialog's count leaves out the turn dismissed here.
    fireEvent.click(within(screen.getByTestId('conversation-top')).getByRole('button', { name: 'Excluir' }));
    expect(screen.getByRole('dialog').textContent).toContain('Vai junto: 1 pergunta e sua resposta.');
  });

  it('after 10 s, focus elsewhere stays where it is', async () => {
    setDismissal.mockResolvedValue({ ok: true });
    twoDone();
    vi.useFakeTimers();
    fireEvent.click(dismissButtons()[1]!);
    await settle();
    const other = dismissButtons()[0]!;
    other.focus();

    act(() => vi.advanceTimersByTime(UNDO_MS));

    expect(screen.queryByTestId('dismissed-line')).toBeNull();
    expect(document.activeElement).toBe(other);
    vi.useRealTimers();
  });

  it('"Desfazer" within 10 s: the undo is sent, the turn is back where it was with its sources, and focus is on its dismiss button', async () => {
    setDismissal.mockResolvedValue({ ok: true });
    twoDone();
    vi.useFakeTimers();
    fireEvent.click(dismissButtons()[0]!);
    await settle();
    act(() => vi.advanceTimersByTime(UNDO_MS - 1000));

    fireEvent.click(within(screen.getByTestId('dismissed-line')).getByRole('button', { name: 'Desfazer' }));
    await settle();

    expect(setDismissal).toHaveBeenLastCalledWith(TURN, 'restore');
    expect(screen.queryByTestId('dismissed-line')).toBeNull();
    const items = turns().getAllByRole('listitem').filter((item) => item.parentElement === screen.getAllByRole('list')[0]);
    expect(within(items[0]!).getByText('Quanto dano causa Fire Bolt?')).toBeTruthy();
    expect(superscripts()).toEqual(['1']);
    expect(within(items[0]!).getByText(/Livro do Jogador\.pdf/)).toBeTruthy();
    expect(document.activeElement).toBe(within(items[0]!).getByRole('button', { name: 'Dispensar resposta' }));
    // The line's time no longer runs: the turn stays.
    act(() => vi.advanceTimersByTime(UNDO_MS));
    expect(turns().getByText('Quanto dano causa Fire Bolt?')).toBeTruthy();
    vi.useRealTimers();
  });

  it('an undo selected before the dismissal was answered waits for it, then undoes it', async () => {
    let answer: (result: { ok: true }) => void = () => undefined;
    setDismissal.mockReturnValueOnce(new Promise((resolve) => {
      answer = resolve;
    }));
    setDismissal.mockResolvedValueOnce({ ok: true });
    twoDone();

    fireEvent.click(dismissButtons()[0]!);
    fireEvent.click(within(screen.getByTestId('dismissed-line')).getByRole('button', { name: 'Desfazer' }));
    await settle();
    expect(setDismissal).toHaveBeenCalledTimes(1);
    // Meanwhile the pill says it is busy.
    expect(within(screen.getByTestId('dismissed-line')).getByRole('button', { name: 'Desfazer' }).getAttribute('aria-busy')).toBe('true');

    answer({ ok: true });
    await waitFor(() => expect(setDismissal).toHaveBeenLastCalledWith(TURN, 'restore'));
    await waitFor(() => expect(turns().getByText('Quanto dano causa Fire Bolt?')).toBeTruthy());
  });

  it('a refused dismissal brings the answer back with the refusal under its actions', async () => {
    setDismissal.mockResolvedValueOnce({ ok: false, problem: { status: 409, category: 'conversation', code: 'conversation.turn_running' } });
    twoDone();

    fireEvent.click(dismissButtons()[0]!);
    await settle();

    expect(screen.queryByTestId('dismissed-line')).toBeNull();
    const items = turns().getAllByRole('listitem').filter((item) => item.parentElement === screen.getAllByRole('list')[0]);
    expect(within(items[0]!).getByText('Quanto dano causa Fire Bolt?')).toBeTruthy();
    const problem = within(items[0]!).getByTestId('dismiss-problem');
    expect(problem.textContent).toBe('Esta resposta ainda está sendo escrita. Espere ela terminar para dispensá-la.');
    const dismiss = within(items[0]!).getByRole('button', { name: 'Dispensar resposta' });
    expect(dismiss.compareDocumentPosition(problem) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.activeElement).toBe(dismiss);

    // Dismissed again, it goes; the refusal with it.
    setDismissal.mockResolvedValueOnce({ ok: true });
    fireEvent.click(dismiss);
    expect(screen.queryByTestId('dismiss-problem')).toBeNull();
  });

  it('a refused undo keeps the line, with the refusal in it, until its time ends', async () => {
    setDismissal.mockResolvedValueOnce({ ok: true });
    setDismissal.mockResolvedValueOnce({ ok: false, problem: { status: 503, category: 'server', code: 'server.unavailable' } });
    twoDone();
    vi.useFakeTimers();
    fireEvent.click(dismissButtons()[0]!);
    await settle();

    fireEvent.click(within(screen.getByTestId('dismissed-line')).getByRole('button', { name: 'Desfazer' }));
    await settle();

    const line = screen.getByTestId('dismissed-line');
    expect(within(line).getByTestId('undo-problem').textContent).toBe(errorText({ category: 'server', code: 'server.unavailable' }, 'pt-BR'));
    expect(turns().queryByText('Quanto dano causa Fire Bolt?')).toBeNull();
    act(() => vi.advanceTimersByTime(UNDO_MS));
    expect(screen.queryByTestId('dismissed-line')).toBeNull();
    expect(turns().queryByText('Quanto dano causa Fire Bolt?')).toBeNull();
    vi.useRealTimers();
  });

  it('an undo still under way when the 10 s end keeps the line; its success then shows the turn again', async () => {
    let answer: (result: { ok: true }) => void = () => undefined;
    setDismissal.mockResolvedValueOnce({ ok: true });
    setDismissal.mockReturnValueOnce(new Promise((resolve) => {
      answer = resolve;
    }));
    twoDone();
    vi.useFakeTimers();
    fireEvent.click(dismissButtons()[0]!);
    await settle();
    fireEvent.click(within(screen.getByTestId('dismissed-line')).getByRole('button', { name: 'Desfazer' }));
    await settle();

    act(() => vi.advanceTimersByTime(UNDO_MS));

    // The line stays, focus on its pill, while the undo is answered.
    const pill = within(screen.getByTestId('dismissed-line')).getByRole('button', { name: 'Desfazer' });
    expect(document.activeElement).toBe(pill);
    answer({ ok: true });
    await settle();
    expect(screen.queryByTestId('dismissed-line')).toBeNull();
    const items = turns().getAllByRole('listitem').filter((item) => item.parentElement === screen.getAllByRole('list')[0]);
    expect(within(items[0]!).getByText('Quanto dano causa Fire Bolt?')).toBeTruthy();
    expect(document.activeElement).toBe(within(items[0]!).getByRole('button', { name: 'Dispensar resposta' }));
  });

  it('an undo refused after the 10 s ended ends the line then, focus moving to the composer', async () => {
    let answer: (result: { ok: false; problem: unknown }) => void = () => undefined;
    setDismissal.mockResolvedValueOnce({ ok: true });
    setDismissal.mockReturnValueOnce(new Promise((resolve) => {
      answer = resolve;
    }));
    twoDone();
    vi.useFakeTimers();
    fireEvent.click(dismissButtons()[0]!);
    await settle();
    fireEvent.click(within(screen.getByTestId('dismissed-line')).getByRole('button', { name: 'Desfazer' }));
    await settle();
    act(() => vi.advanceTimersByTime(UNDO_MS));
    expect(screen.queryByTestId('dismissed-line')).not.toBeNull();

    answer({ ok: false, problem: { status: 503, category: 'server', code: 'server.unavailable' } });
    await settle();

    expect(screen.queryByTestId('dismissed-line')).toBeNull();
    expect(turns().queryByText('Quanto dano causa Fire Bolt?')).toBeNull();
    expect(document.activeElement).toBe(composer());
    expect(polite()).toContain(errorText({ category: 'server', code: 'server.unavailable' }, 'pt-BR'));
  });

  it('a conversation whose every turn was dismissed shows its intro once the lines end, as a reload would', async () => {
    setDismissal.mockResolvedValue({ ok: true });
    twoDone();
    vi.useFakeTimers();
    fireEvent.click(dismissButtons()[0]!);
    fireEvent.click(dismissButtons()[0]!);
    await settle();
    expect(screen.queryByTestId('conversation-intro')).toBeNull();

    act(() => vi.advanceTimersByTime(UNDO_MS));

    expect(screen.queryAllByTestId('dismissed-line')).toHaveLength(0);
    expect(screen.getByTestId('conversation-intro')).toBeTruthy();
  });

  it('a stopped answer asked on the page is dismissed like a done one, in English too', async () => {
    setDismissal.mockResolvedValue({ ok: true });
    view({ language: 'en' });
    const stream = await ask('What does Fire Bolt do?', 'en');
    stream.emit('delta', { text: 'It deals' }, 1);
    expect(screen.queryByRole('button', { name: 'Dismiss answer' })).toBeNull();
    stream.emit('done', { stopped: true, silent: false, references: [] }, 2);

    fireEvent.click(turns().getByRole('button', { name: 'Dismiss answer' }));

    expect(screen.getByTestId('dismissed-line').textContent).toBe('Answer dismissed.Undo');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Undo' }));
    expect(setDismissal).toHaveBeenCalledWith(TURN, 'dismiss');
  });

  // --- Story 3.12: bookmark answers and find them again

  function bookmarkOf(item: HTMLElement, name = 'Salvar resposta') {
    return within(item).getByRole('button', { name });
  }

  function turnItems() {
    return turns().getAllByRole('listitem').filter((item) => item.parentElement === screen.getAllByRole('list')[0]);
  }

  it('a done answer has "Salvar resposta" before dismiss; a stopped, a failed and a running one have none', async () => {
    opened({
      conversationId: CONVERSATION,
      name: 'Fire Bolt',
      stored: [
        stored(TURN, 'Quanto dano?', [['delta', { text: 'Fire Bolt causa 1d10.' }], ['done', DONE]]),
        stored(SECOND, 'E se eu parar?', [['delta', { text: 'Começo' }], ['done', { ...DONE, stopped: true, references: [] }]]),
        stored(THIRD, 'E agora?', [['delta', { text: 'Metade' }], ['error', { code: 'model.unavailable' }]]),
        stored(PASSAGE_C, 'E depois?', [['delta', { text: 'Escrevendo' }]]),
        // Silent: done with no reference and no model part (the sources said nothing): it cannot be saved.
        stored(PASSAGE_B, 'E o tempo?', [['delta', { text: 'Nada.' }], ['done', { ...DONE, references: [], silent: true }]]),
      ],
    });
    await waitFor(() => expect(streams).toHaveLength(1));
    const items = turnItems();
    expect(within(items[4]!).queryByRole('button', { name: 'Salvar resposta' })).toBeNull();
    expect(within(items[4]!).getByRole('button', { name: 'Dispensar resposta' })).toBeTruthy();
    const save = bookmarkOf(items[0]!);
    const dismiss = within(items[0]!).getByRole('button', { name: 'Dispensar resposta' });
    // Before dismiss, unpressed, a filled circle with the outlined bookmark.
    expect(save.compareDocumentPosition(dismiss) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(save.getAttribute('aria-pressed')).toBe('false');
    expect(save.dataset.set).toBeUndefined();
    expect(save.querySelector('span svg path')?.getAttribute('fill')).toBe('none');
    // A stopped answer keeps its dismiss only; a failed one and one being written have neither.
    expect(within(items[1]!).queryByRole('button', { name: 'Salvar resposta' })).toBeNull();
    expect(within(items[1]!).getByRole('button', { name: 'Dispensar resposta' })).toBeTruthy();
    expect(within(items[2]!).queryByRole('button', { name: 'Salvar resposta' })).toBeNull();
    expect(within(items[3]!).queryByRole('button', { name: 'Salvar resposta' })).toBeNull();
    // Once the answer being written is done, it has one too; each turn's item is named by its id.
    streams[0]!.emit('done', DONE, 2);
    expect(bookmarkOf(items[3]!)).toBeTruthy();
    expect(items.map((item) => item.id)).toEqual([`turn-${TURN}`, `turn-${SECOND}`, `turn-${THIRD}`, `turn-${PASSAGE_C}`, `turn-${PASSAGE_B}`]);
  });

  it('a press inverts the button at once, then saves; pressed again it removes, and a stored saved answer opens set', async () => {
    let answer: (result: { ok: true }) => void = () => undefined;
    setBookmark.mockReturnValueOnce(new Promise((resolve) => {
      answer = resolve;
    }));
    setBookmark.mockResolvedValue({ ok: true });
    opened({
      conversationId: CONVERSATION,
      name: 'Fire Bolt',
      stored: [
        stored(TURN, 'Quanto dano?', [['delta', { text: 'Fire Bolt causa 1d10.' }], ['done', DONE]]),
        stored(SECOND, 'E Fireball?', [['delta', { text: 'Fireball causa 8d6.' }], ['done', DONE]], 'pt-BR', true),
      ],
    });
    const [first, second] = turnItems();
    // Saved already: an outlined circle with the filled bookmark, named for its removal and pressed.
    const set = bookmarkOf(second!, 'Remover dos itens salvos');
    expect(set.getAttribute('aria-pressed')).toBe('true');
    expect(set.dataset.set).toBe('true');
    expect(set.querySelector('span svg path')?.getAttribute('fill')).toBe('currentColor');

    fireEvent.click(bookmarkOf(first!));

    // At once, before the backend answers.
    const now = bookmarkOf(first!, 'Remover dos itens salvos');
    expect(now.getAttribute('aria-pressed')).toBe('true');
    await waitFor(() => expect(setBookmark).toHaveBeenLastCalledWith(TURN, 'save'));
    answer({ ok: true });
    await act(async () => {
      await Promise.resolve();
    });
    expect(bookmarkOf(first!, 'Remover dos itens salvos')).toBeTruthy();
    expect(screen.queryByTestId('bookmark-problem')).toBeNull();

    fireEvent.click(set);
    expect(bookmarkOf(second!).getAttribute('aria-pressed')).toBe('false');
    await waitFor(() => expect(setBookmark).toHaveBeenLastCalledWith(SECOND, 'remove'));
    // A bookmark never touches the dismissal.
    expect(setDismissal).not.toHaveBeenCalled();
  });

  it('a refusal puts the button back and says why under the actions; the next press clears it', async () => {
    const notDone = { status: 409, category: 'conversation', code: 'conversation.turn_not_done', params: {} };
    setBookmark.mockResolvedValueOnce({ ok: false, problem: notDone }).mockResolvedValue({ ok: true });
    twoDone();
    const [first] = turnItems();

    fireEvent.click(bookmarkOf(first!));
    expect(bookmarkOf(first!, 'Remover dos itens salvos')).toBeTruthy();

    await waitFor(() => expect(screen.getByTestId('bookmark-problem').textContent).toBe('Só uma resposta concluída pode ser salva.'));
    expect(bookmarkOf(first!).getAttribute('aria-pressed')).toBe('false');
    expect(polite()).toContain('Só uma resposta concluída pode ser salva.');
    // The refusal sits under the actions.
    const actions = bookmarkOf(first!).parentElement!;
    expect(actions.compareDocumentPosition(screen.getByTestId('bookmark-problem')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(bookmarkOf(first!));
    expect(screen.queryByTestId('bookmark-problem')).toBeNull();
    await waitFor(() => expect(setBookmark).toHaveBeenCalledTimes(2));
  });

  it('presses in a row are sent in order, and only the latest one\'s refusal puts the button back', async () => {
    const answers: ((result: { ok: boolean; problem?: unknown }) => void)[] = [];
    setBookmark.mockImplementation(() => new Promise((resolve) => answers.push(resolve as never)));
    twoDone();
    const [first] = turnItems();
    fireEvent.click(bookmarkOf(first!));
    fireEvent.click(bookmarkOf(first!, 'Remover dos itens salvos'));
    expect(bookmarkOf(first!).getAttribute('aria-pressed')).toBe('false');
    // The second waits for the first.
    await act(async () => {
      await Promise.resolve();
    });
    expect(setBookmark).toHaveBeenCalledTimes(1);
    answers[0]!({ ok: false, problem: { status: 503, category: 'server', code: 'server.unavailable' } });
    await waitFor(() => expect(setBookmark).toHaveBeenCalledTimes(2));
    expect(setBookmark.mock.calls.map((call) => call[1])).toEqual(['save', 'remove']);
    // The first's refusal is not the latest press: nothing moves.
    expect(bookmarkOf(first!).getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByTestId('bookmark-problem')).toBeNull();
    answers[1]!({ ok: true });
    await act(async () => {
      await Promise.resolve();
    });
    expect(bookmarkOf(first!).getAttribute('aria-pressed')).toBe('false');
  });

  it('a change tells the saved items panel to read its list again', async () => {
    setBookmark.mockResolvedValue({ ok: true });
    const { SavedItemsProvider, useSavedItems } = await import('@/components/saved/SavedItems');
    function Version() {
      return <output data-testid="saved-version">{useSavedItems()?.version}</output>;
    }
    twoDone();
    cleanup();
    opened({
      conversationId: CONVERSATION,
      name: 'Fire Bolt',
      stored: [stored(TURN, 'Quanto dano?', [['delta', { text: 'Fire Bolt causa 1d10.' }], ['done', DONE]])],
      around: (children) => (
        <SavedItemsProvider currentCampaignId={CAMPAIGN}>
          {children}
          <Version />
        </SavedItemsProvider>
      ),
    });
    expect(screen.getByTestId('saved-version').textContent).toBe('0');
    fireEvent.click(bookmarkOf(turnItems()[0]!));
    await waitFor(() => expect(screen.getByTestId('saved-version').textContent).toBe('1'));
  });

  it('opened at a turn (a saved item\'s "Ir") shows that turn instead of the last, with focus on it', () => {
    const scrolled: Element[] = [];
    const before = Element.prototype.scrollIntoView;
    // jsdom does not scroll: note what the page asks to bring into view.
    Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
      scrolled.push(this);
    };
    const three = [
      stored(TURN, 'Quanto dano?', [['delta', { text: 'Um.' }], ['done', DONE]]),
      stored(SECOND, 'E Fireball?', [['delta', { text: 'Dois.' }], ['done', DONE]]),
      stored(THIRD, 'E Shield?', [['delta', { text: 'Três.' }], ['done', DONE]]),
    ];
    opened({ conversationId: CONVERSATION, name: 'Fire Bolt', stored: three, focusTurn: SECOND });
    const target = document.getElementById(`turn-${SECOND}`)!;
    expect(scrolled).toEqual([target]);
    expect(document.activeElement).toBe(target);
    // Focusable by the page only, never a stop of the keyboard; the other turns are not focusable at all.
    expect(target.getAttribute('tabindex')).toBe('-1');
    expect(document.getElementById(`turn-${TURN}`)!.hasAttribute('tabindex')).toBe(false);
    cleanup();
    scrolled.length = 0;

    // A turn not among those loaded (older than the newest 200, or gone): the last turn, as before, and focus stays.
    opened({ conversationId: CONVERSATION, name: 'Fire Bolt', stored: three, focusTurn: PASSAGE_C });
    expect(scrolled).toEqual([document.getElementById(`turn-${THIRD}`)]);
    expect(document.activeElement).toBe(document.body);
    Element.prototype.scrollIntoView = before;
  });

  it('a dismissal and its undo tell the saved items panel to read its list again', async () => {
    setDismissal.mockResolvedValue({ ok: true });
    const { SavedItemsProvider, useSavedItems } = await import('@/components/saved/SavedItems');
    function Version() {
      return <output data-testid="saved-version">{useSavedItems()?.version}</output>;
    }
    opened({
      conversationId: CONVERSATION,
      name: 'Fire Bolt',
      stored: [stored(TURN, 'Quanto dano?', [['delta', { text: 'Fire Bolt causa 1d10.' }], ['done', DONE]], 'pt-BR', true)],
      around: (children) => (
        <SavedItemsProvider currentCampaignId={CAMPAIGN}>
          {children}
          <Version />
        </SavedItemsProvider>
      ),
    });
    fireEvent.click(dismissButtons()[0]!);
    await waitFor(() => expect(screen.getByTestId('saved-version').textContent).toBe('1'));
    fireEvent.click(within(screen.getByTestId('dismissed-line')).getByRole('button', { name: 'Desfazer' }));
    await waitFor(() => expect(screen.getByTestId('saved-version').textContent).toBe('2'));
  });

  it('Ctrl+Shift+S over an open source view closes it and opens the saved items panel in its place, with focus inside', async () => {
    const { SavedItemsProvider } = await import('@/components/saved/SavedItems');
    const { SavedItemsPanel } = await import('@/components/saved/SavedItemsPanel');
    const { ShellFrame } = await import('@/components/ShellPanel');
    const user = userEvent.setup();
    opened({
      conversationId: CONVERSATION,
      name: 'Fire Bolt',
      stored: [stored(TURN, 'Quanto dano?', [['delta', { text: 'Fire Bolt causa 1d10.' }], ['citation', { passageId: PASSAGE_A, offset: 21 }], ['done', DONE]])],
      around: (children) => (
        <SavedItemsProvider currentCampaignId={CAMPAIGN}>
          <ShellFrame>
            {children}
            <SavedItemsPanel language="pt-BR" action={async (previous) => previous} load={async () => ({ ok: true, items: [], total: 0 })} />
          </ShellFrame>
        </SavedItemsProvider>
      ),
    });
    await user.click(within(screen.getAllByRole('list', { name: 'Fontes' })[0]!).getAllByRole('button')[0]!);
    expect(screen.getByRole('button', { name: 'Fechar a fonte' })).toBeTruthy();

    await user.keyboard('{Control>}{Shift>}s{/Shift}{/Control}');

    expect(screen.queryByRole('button', { name: 'Fechar a fonte' })).toBeNull();
    expect(screen.getAllByRole('complementary')).toHaveLength(1);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Fechar itens salvos' }));
  });

  it('opened at a turn while the page behind a panel cannot take focus yet, the turn takes it once it can', async () => {
    const before = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function scrollIntoView() {};
    // As behind an open panel under 1280px: the first focus does nothing (the page is inert), later ones work.
    const original = HTMLElement.prototype.focus;
    let refused = 0;
    const focus = vi.spyOn(HTMLLIElement.prototype, 'focus').mockImplementation(function focus(this: HTMLLIElement, options?: FocusOptions) {
      if (refused < 2) {
        refused += 1;
        return;
      }
      original.call(this, options);
    });
    try {
      opened({
        conversationId: CONVERSATION,
        name: 'Fire Bolt',
        stored: [
          stored(TURN, 'Quanto dano?', [['delta', { text: 'Um.' }], ['done', DONE]]),
          stored(SECOND, 'E Fireball?', [['delta', { text: 'Dois.' }], ['done', DONE]]),
        ],
        focusTurn: TURN,
      });
      expect(document.activeElement).not.toBe(document.getElementById(`turn-${TURN}`));

      await waitFor(() => expect(document.activeElement).toBe(document.getElementById(`turn-${TURN}`)));
      expect(refused).toBe(2);
    } finally {
      focus.mockRestore();
      Element.prototype.scrollIntoView = before;
    }
  });

  it('names the bookmark in English too', () => {
    opened({
      conversationId: CONVERSATION,
      name: 'Fire Bolt',
      language: 'en',
      stored: [
        stored(TURN, 'How much?', [['delta', { text: 'One.' }], ['done', DONE]], 'en'),
        stored(SECOND, 'And Fireball?', [['delta', { text: 'Two.' }], ['done', DONE]], 'en', true),
      ],
    });
    const [first, second] = turnItems();
    expect(bookmarkOf(first!, 'Save answer').getAttribute('aria-pressed')).toBe('false');
    expect(bookmarkOf(second!, 'Remove from saved items').getAttribute('aria-pressed')).toBe('true');
  });
});

describe('records in answers (Story 4.3 part C)', () => {
  const RECORD = '0190a0b0-0000-7000-8000-000000000700';
  const PICTURE_PAGE = (page: number) => ({
    page,
    pageTotal: 4,
    picture: { width: 1000, height: 2000 },
    lines: [{ text: `Linha ${page}`, box: [0.1, 0.2, 0.5, 0.22] }],
    text: null,
    passages: page === 3 ? [{ id: PASSAGE_A, boxes: [[0.1, 0.19, 0.7, 0.26]] }] : [],
    outcome: 'read_directly',
  });
  let load: ReturnType<typeof vi.fn<LoadPage>>;

  /** A cited record's reference as the done event carries it: the Bola de Fogo spell, read from `passageIds` on p. 3. */
  function recordReference(number: number, passageIds: string[], more: Record<string, unknown> = {}) {
    return {
      number,
      kind: 'record' as const,
      recordId: RECORD,
      recordType: 'spell',
      name: 'Bola de Fogo',
      fields: [
        { name: 'Alcance', value: '45 m' },
        { name: 'Nível', value: '3' },
      ],
      materialName: 'Livro do Jogador.pdf',
      sectionPath: ['Magias', 'Bola de Fogo'],
      page: 3,
      passageIds,
      removed: false,
      tier: 'system',
      ...more,
    };
  }

  /** A finished answer citing passage B (reference 1) and the record (reference 2, read from passage A, maybe removed). */
  async function answered(removed = false, language: 'pt-BR' | 'en' = 'pt-BR'): Promise<void> {
    const stream = await ask('Qual o alcance de Bola de Fogo?', language);
    stream.emit('delta', { text: 'Um. Dois.' }, 1);
    stream.emit('citation', { passageId: PASSAGE_B, offset: 3 }, 2);
    stream.emit('citation', { recordId: RECORD, offset: 9 }, 3);
    stream.emit('citation', { passageId: PASSAGE_A, offset: 9 }, 4);
    stream.emit(
      'done',
      {
        stopped: false,
        silent: false,
        references: [
          reference(1, [PASSAGE_B], { page: 12 }),
          recordReference(2, [PASSAGE_A], { removed }),
          reference(3, [PASSAGE_A]),
        ],
      },
      5,
    );
  }

  function list(): HTMLElement {
    return screen.getAllByRole('list', { name: /^(Fontes|Sources)$/ })[0]!;
  }

  beforeEach(() => {
    streams = [];
    postQuestion.mockReset();
    stopTurn.mockReset();
    stopTurn.mockResolvedValue(true);
    localStorage.clear();
    load = vi.fn<LoadPage>(async (_turn, _number, page) => PICTURE_PAGE(page));
  });
  afterEach(() => {
    cleanup();
  });

  it('numbers a record citation with its entry, and a passage it was read from with that passage\'s own reference', async () => {
    view({ loadPage: load });
    await answered();

    // The record's citation carries the record entry's number; passage A, also among the record's passages, its own.
    expect(superscripts()).toEqual(['1', '2', '3']);
  });

  it('shows a record as its own entry: its name and type, its fields as a two-column list, then its source line', async () => {
    view({ loadPage: load });
    await answered();

    const items = within(list()).getAllByRole('listitem');
    expect(items.map((item) => item.getAttribute('value'))).toEqual(['1', '2', '3']);
    // A passage's reference stays one line.
    expect(items[0]!.textContent).toBe('Livro do Jogador.pdf, Magias › Fire Bolt, p. 12');
    const record = items[1]!;
    expect(record.getAttribute('data-kind')).toBe('record');
    expect(record.textContent).toContain('Sistema');
    expect(within(record).getByText('Bola de Fogo').className).toMatch(/recordName/);
    expect(within(record).getByText('Magia').className).toMatch(/recordType/);
    const fields = record.querySelector('dl')!;
    expect(fields.getAttribute('aria-label')).toBe('Campos');
    expect([...fields.querySelectorAll('dt')].map((term) => term.textContent)).toEqual(['Alcance', 'Nível']);
    expect([...fields.querySelectorAll('dd')].map((value) => value.textContent)).toEqual(['45 m', '3']);
    // No rule closes the fields inside the list: the answer's own rule follows the references.
    expect(record.querySelector('hr')).toBeNull();
    // Only the source line is a button; the name opens nothing.
    expect(within(record).getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Livro do Jogador.pdf, Magias › Bola de Fogo, p. 3',
    ]);
    expect(record.querySelector('a')).toBeNull();
    expect(document.body.innerHTML).not.toContain('style=');
  });

  it('opens the record\'s source line at its page on the turn\'s ground with its passages marked, and gives focus back', async () => {
    view({ loadPage: load });
    await answered();
    const user = userEvent.setup();
    const line = within(list()).getByRole('button', { name: 'Livro do Jogador.pdf, Magias › Bola de Fogo, p. 3' });

    line.focus();
    await user.keyboard('{Enter}');

    const dialog = screen.getByRole('dialog', { name: 'Livro do Jogador.pdf, Magias › Bola de Fogo' });
    expect(load).toHaveBeenCalledWith(TURN, 2, 3, expect.any(AbortSignal));
    await waitFor(() => expect(dialog.querySelector('image')).not.toBeNull());
    expect(dialog.querySelector('image')!.getAttribute('href')).toBe(`/api/v1/turns/${TURN}/references/2/pages/3/picture`);
    expect(within(dialog).getByRole('group', { name: 'trecho citado' }).textContent).toBe('Linha 3');

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(line);
  });

  it('strikes a removed record\'s source line through, opens nothing, and keeps its fields as written', async () => {
    view({ loadPage: load });
    await answered(true);

    const record = within(list()).getAllByRole('listitem')[1]!;
    expect(record.querySelector('s')?.textContent).toBe('Livro do Jogador.pdf, Magias › Bola de Fogo, p. 3');
    expect(record.textContent).toContain('— fonte removida');
    expect(record.querySelector('button')).toBeNull();
    expect([...record.querySelectorAll('dd')].map((value) => value.textContent)).toEqual(['45 m', '3']);
  });

  it('says a record\'s name and type before its source line in the polite region, in English too', async () => {
    view({ language: 'en', loadPage: load });
    await answered(false, 'en');

    const spoken = [...screen.getByTestId('conversation-polite').querySelectorAll('li')].map((item) => item.textContent);
    expect(spoken[1]).toBe('System: Bola de Fogo, Spell. Livro do Jogador.pdf, Magias › Bola de Fogo, p. 3');
    expect(within(list()).getByText('Spell')).toBeTruthy();
    expect(list().querySelector('dl')?.getAttribute('aria-label')).toBe('Fields');
  });

  it('leaves out a record reference that is not well formed, and a citation naming both a passage and a record', async () => {
    view({ loadPage: load });
    const stream = await ask('Qual o alcance?');
    stream.emit('delta', { text: 'Um.' });
    stream.emit('citation', { passageId: PASSAGE_A, recordId: RECORD, offset: 3 });
    stream.emit('done', {
      silent: false,
      references: [reference(1, [PASSAGE_A]), recordReference(2, [PASSAGE_A], { recordType: '' }), recordReference(3, [PASSAGE_A], { fields: [{ name: 'x' }] })],
    });

    expect(within(list()).getAllByRole('listitem')).toHaveLength(1);
    expect(superscripts()).toEqual([]);
  });

  it('Story 4.4 part B: names a cited record of a type the GM approved by the campaign system\'s type, for the eye and the ear', async () => {
    view({ loadPage: load, recordTypes: [{ key: 'talento', name: 'Talento' }] });
    const stream = await ask('O que faz Conjurador de Guerra?');
    stream.emit('delta', { text: 'Um.' });
    stream.emit('citation', { recordId: RECORD, offset: 3 });
    stream.emit('done', { silent: false, references: [recordReference(1, [PASSAGE_A], { recordType: 'talento' })] });

    const items = within(list()).getAllByRole('listitem');
    expect(within(items[0]!).getByText('Talento').className).toMatch(/recordType/);
    expect([...screen.getByTestId('conversation-polite').querySelectorAll('li')].map((item) => item.textContent)).toEqual([
      'Sistema: Bola de Fogo, Talento. Livro do Jogador.pdf, Magias › Bola de Fogo, p. 3',
    ]);
  });

  it('keeps a record of a type it does not know, with its number and superscript, naming the type by its key', async () => {
    view({ loadPage: load });
    const stream = await ask('Qual o alcance?');
    stream.emit('delta', { text: 'Um.' });
    stream.emit('citation', { recordId: RECORD, offset: 3 });
    stream.emit('done', { silent: false, references: [recordReference(1, [PASSAGE_A], { recordType: 'vehicle' })] });

    const items = within(list()).getAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(within(items[0]!).getByText('vehicle').className).toMatch(/recordType/);
    expect(superscripts()).toEqual(['1']);
    expect([...screen.getByTestId('conversation-polite').querySelectorAll('li')].map((item) => item.textContent)).toEqual([
      'Sistema: Bola de Fogo, vehicle. Livro do Jogador.pdf, Magias › Bola de Fogo, p. 3',
    ]);
  });
});
