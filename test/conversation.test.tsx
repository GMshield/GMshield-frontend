import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UrlStorage } from 'tus-js-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => undefined }) }));

type Ask = (campaignId: string, question: string) => Promise<unknown>;
const postQuestion = vi.fn<Ask>();
vi.mock('@/client/conversation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/client/conversation')>()),
  postQuestion,
}));

const { Conversation, DRAFT_PREFIX } = await import('@/components/conversation/Conversation');
const { UploadsProvider, useUploads } = await import('@/components/uploads/UploadsProvider');
const { uploadTexts } = await import('@/components/uploads/upload-texts');

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
  emit(name: string, data: unknown): void {
    act(() => {
      this.dispatchEvent(new MessageEvent(name, { data: JSON.stringify(data) }));
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

  it('shows the generic text of an error event and says it', async () => {
    view();
    const stream = await ask('Quanto dano?');
    stream.emit('delta', { text: 'Fire Bolt ' });

    stream.emit('error', { code: 'model.unavailable' });

    const generic = 'Algo deu errado no servidor. Tente de novo em instantes.';
    expect(stream.closed).toBe(true);
    expect(turns().getByText(generic)).toBeTruthy();
    expect(polite()).toBe(generic);
    expect(turns().getByText('Fire Bolt')).toBeTruthy();
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

  it('leaves the turn as it is while the browser reconnects after a lost connection', async () => {
    view();
    const stream = await ask('Quanto dano?');
    stream.emit('delta', { text: 'Fire Bolt ' });

    act(() => {
      stream.dispatchEvent(new Event('error'));
    });

    expect(stream.closed).toBe(false);
    expect(turns().getByText('Fire Bolt')).toBeTruthy();
    expect(turns().queryByText('Algo deu errado no servidor. Tente de novo em instantes.')).toBeNull();
    expect(polite()).toBe('Respondendo…');
  });

  it('shows the generic server text when the browser gives the stream up', async () => {
    view();
    const stream = await ask('Quanto dano?');
    stream.emit('delta', { text: 'Fire Bolt ' });
    stream.readyState = 2;

    act(() => {
      stream.dispatchEvent(new Event('error'));
    });

    const generic = 'Algo deu errado no servidor. Tente de novo em instantes.';
    expect(stream.closed).toBe(true);
    expect(turns().getByText(generic)).toBeTruthy();
    expect(polite()).toBe(generic);
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
