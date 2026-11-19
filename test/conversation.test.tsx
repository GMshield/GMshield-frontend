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

/** The turns as the screen shows them (the live region repeats some of their words). */
function turns() {
  return within(screen.getByRole('list'));
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
    stream.emit('citation', { passageId: '0190a0b0-0000-7000-8000-000000000009', offset: 16 });
    expect(turns().getByText('1d10').tagName).toBe('STRONG');
    expect(document.querySelector('hr')).toBeNull();

    stream.emit('done', {});

    expect(stream.closed).toBe(true);
    expect(document.querySelector('hr')).not.toBeNull();
    expect(polite()).toBe('Fire Bolt causa 1d10 de dano.');
    // No bubble, card or avatar: the answer is text in the column.
    expect(document.querySelector('img')).toBeNull();
  });

  it('renders the answer as sanitized Markdown: no image, a link as its text and address, no raw HTML', async () => {
    view();
    const stream = await ask('Quais links?');

    stream.emit('delta', {
      text: 'Veja ![mapa](https://evil.example/x.png) e [o SRD](https://srd.example/fire-bolt).\n\n<b>negrito</b><script>alert(1)</script><img src=x onerror=alert(1)>',
    });
    stream.emit('done', {});

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
    stream.emit('done', {});

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
