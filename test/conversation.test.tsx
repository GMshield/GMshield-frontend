import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UrlStorage } from 'tus-js-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => undefined }) }));

type Ask = (campaignId: string, question: string) => Promise<unknown>;
const postQuestion = vi.fn<Ask>();
const stopTurn = vi.fn<(turnId: string) => Promise<boolean>>();
vi.mock('@/client/conversation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/client/conversation')>()),
  postQuestion,
  stopTurn,
}));

const { Conversation, DRAFT_PREFIX, RECONNECT_GIVE_UP_MS } = await import('@/components/conversation/Conversation');
const { UploadsProvider, useUploads } = await import('@/components/uploads/UploadsProvider');
const { uploadTexts } = await import('@/components/uploads/upload-texts');
const { errorText } = await import('@/messages');

const CAMPAIGN = '0190a0b0-0000-7000-8000-000000000002';
const TURN = '0190a0b0-0000-7000-8000-000000000021';
const PASSAGE_A = '0190a0b0-0000-7000-8000-000000000009';
const PASSAGE_B = '0190a0b0-0000-7000-8000-00000000000b';
const PASSAGE_C = '0190a0b0-0000-7000-8000-00000000000c';

/** A source reference as the done event carries it (Story 2.5). */
function reference(number: number, passageIds: string[], more: Record<string, unknown> = {}) {
  return { number, materialName: 'Livro do Jogador.pdf', sectionPath: ['Magias', 'Fire Bolt'], page: 3, passageIds, removed: false, ...more };
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

function view(options: { language?: 'pt-BR' | 'en'; hasSources?: boolean; review?: { href: string; name: string } | null } = {}) {
  return render(
    <UploadsProvider texts={uploadTexts(options.language ?? 'pt-BR')} belonging={null} urlStorage={memoryStorage()}>
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

    expect(postQuestion).toHaveBeenCalledWith(CAMPAIGN, 'Uma\nduas\n\n\n\n\n\n');
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

  it('keeps the draft per campaign in this browser and clears it on send', async () => {
    localStorage.setItem(`${DRAFT_PREFIX}${CAMPAIGN}`, 'Rascunho guardado');
    view();
    await waitFor(() => expect(composer().value).toBe('Rascunho guardado'));
    const user = userEvent.setup();
    await user.type(composer(), '?');
    expect(localStorage.getItem(`${DRAFT_PREFIX}${CAMPAIGN}`)).toBe('Rascunho guardado?');

    postQuestion.mockResolvedValueOnce({ ok: true, turn: { id: TURN, conversationId: 'c', language: 'pt-BR' } });
    await user.click(screen.getByRole('button', { name: 'Enviar' }));

    expect(localStorage.getItem(`${DRAFT_PREFIX}${CAMPAIGN}`)).toBeNull();
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

  it('renders the answer as sanitized Markdown: no image, a link as its text and address, no raw HTML', async () => {
    view();
    const stream = await ask('Quais links?');

    stream.emit('delta', {
      text: 'Veja ![mapa](https://evil.example/x.png) e [o SRD](https://srd.example/fire-bolt).\n\n<b>negrito</b><script>alert(1)</script><img src=x onerror=alert(1)>',
    });
    stream.emit('citation', { passageId: PASSAGE_A, offset: 4 });
    stream.emit('done', doneWith(PASSAGE_A));

    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('a')).toBeNull();
    expect(document.querySelector('script')).toBeNull();
    expect(document.querySelector('b')).toBeNull();
    expect(turns().getByText('o SRD (https://srd.example/fire-bolt)')).toBeTruthy();
    expect(polite()).toContain('o SRD (https://srd.example/fire-bolt)');
    expect(document.body.innerHTML).not.toContain('evil.example');
    expect(document.body.innerHTML).not.toContain('onerror');
    expect(document.body.innerHTML).not.toContain('style=');
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
    expect(localStorage.getItem(`${DRAFT_PREFIX}${CAMPAIGN}`)).toBe('Quanto dano causa Fire Bolt?');

    let refuse: (value: unknown) => void = () => undefined;
    postQuestion.mockImplementationOnce(() => new Promise((resolve) => (refuse = resolve)));
    await user.keyboard('{Enter}');
    expect(composer().value).toBe('');
    await user.type(composer(), 'Outra pergunta');
    await act(async () => refuse({ ok: false, problem: { status: 400, category: 'request', code: 'request.invalid', params: {} } }));

    expect(composer().value).toBe('Outra pergunta');
    expect(localStorage.getItem(`${DRAFT_PREFIX}${CAMPAIGN}`)).toBe('Outra pergunta');
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
    // References open nothing yet (Story 2.7).
    expect(list.querySelector('a, button')).toBeNull();
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
    expect(polite()).toBe('The sources say nothing about this.');
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

  it('drops any sentinel the model text carries, so it never shows as a superscript', async () => {
    view();
    const stream = await ask('Quanto dano?');
    stream.emit('delta', { text: `Um${String.fromCodePoint(0xf0007)} dois.` });
    stream.emit('citation', { passageId: PASSAGE_A, offset: 9 });
    stream.emit('done', doneWith(PASSAGE_A));

    expect(superscripts()).toEqual(['1']);
    expect(document.body.innerHTML).not.toContain(String.fromCodePoint(0xf0007));
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
    expect(postQuestion).toHaveBeenLastCalledWith(CAMPAIGN, 'Outra pergunta');
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

  it('re-asks an outage in place with Tentar de novo', async () => {
    view();
    const stream = await ask('Quanto dano causa Fire Bolt?');
    stream.emit('error', { code: 'job.attempts_exhausted' }, 1);
    expect(turns().getByText('O serviço de IA está indisponível agora.')).toBeTruthy();

    postQuestion.mockResolvedValueOnce({ ok: true, turn: { id: TURN, conversationId: 'c', language: 'pt-BR' } });
    fireEvent.click(turns().getByRole('button', { name: 'Tentar de novo' }));

    await waitFor(() => expect(streams).toHaveLength(2));
    expect(postQuestion).toHaveBeenLastCalledWith(CAMPAIGN, 'Quanto dano causa Fire Bolt?');
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
