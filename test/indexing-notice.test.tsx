import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UrlStorage } from 'tus-js-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { IndexingPoll } from '@/client/conversation';

// The notice must never refresh the page: every router.refresh is counted.
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const fetchIndexing = vi.fn<(signal?: AbortSignal) => Promise<IndexingPoll>>();
const postQuestion = vi.fn();
vi.mock('@/client/conversation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/client/conversation')>()),
  fetchIndexing,
  postQuestion,
}));

const { IndexingNotice, INDEXING_POLL_MS, INDEXING_READ_TIMEOUT_MS, INDEXING_STALL_MS } = await import('@/components/IndexingNotice');
const { Conversation } = await import('@/components/conversation/Conversation');
const { UploadsProvider } = await import('@/components/uploads/UploadsProvider');
const { uploadTexts } = await import('@/components/uploads/upload-texts');

const CAMPAIGN = '0190a0b0-0000-7000-8000-000000000002';
const TURN = '0190a0b0-0000-7000-8000-000000000021';
const PASSAGE = '0190a0b0-0000-7000-8000-000000000009';

const count = (remaining: number): IndexingPoll => ({ kind: 'count', remaining });
const NONE: IndexingPoll = { kind: 'none' };
const FAILED: IndexingPoll = { kind: 'failed' };

/** The notice's line, or null when it is not on the screen. */
function line(container: HTMLElement): HTMLElement | null {
  return container.querySelector('[data-status="warning"]');
}

/** Runs one poll interval and lets the read it started settle. */
async function tick(times = 1): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await act(() => vi.advanceTimersByTimeAsync(INDEXING_POLL_MS));
  }
}

function setVisibility(state: 'visible' | 'hidden'): void {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(state);
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

beforeEach(() => {
  refresh.mockClear();
  fetchIndexing.mockReset();
  postQuestion.mockReset();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('the indexing notice', () => {
  it('says how many passages are left, in both languages, as a warning with no dismiss control and no live role', () => {
    for (const [language, text] of [
      ['pt-BR', 'AtençãoPreparando as fontes para busca: faltam 2.000 trechos'],
      ['en', 'WarningPreparing your sources for search: 2,000 passages left'],
    ] as const) {
      const { container } = render(<IndexingNotice remaining={2000} language={language} />);
      expect(line(container)!.textContent).toBe(text);
      expect(screen.queryByRole('status')).toBeNull();
      expect(container.querySelector('[aria-live]')).toBeNull();
      expect(screen.queryByRole('button')).toBeNull();
      expect(container.querySelector('[style]')).toBeNull();
      cleanup();
    }
  });

  it('reads the count every 5 s and shows each new number, never refreshing the page', async () => {
    vi.useFakeTimers();
    fetchIndexing.mockResolvedValueOnce(count(1800)).mockResolvedValueOnce(count(1500));
    const { container } = render(<IndexingNotice remaining={2000} language="pt-BR" />);

    await act(() => vi.advanceTimersByTimeAsync(INDEXING_POLL_MS - 1));
    expect(fetchIndexing).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(fetchIndexing).toHaveBeenCalledTimes(1);
    expect(line(container)!.textContent).toContain('faltam 1.800 trechos');
    await tick();
    expect(line(container)!.textContent).toContain('faltam 1.500 trechos');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('keeps the last number when a read fails, and the next read updates it (matrix row "Poll fails")', async () => {
    vi.useFakeTimers();
    fetchIndexing.mockResolvedValueOnce(FAILED).mockResolvedValueOnce(count(1900));
    const { container } = render(<IndexingNotice remaining={2000} language="en" />);

    await tick();
    expect(line(container)!.textContent).toContain('2,000 passages left');
    await tick();
    expect(line(container)!.textContent).toContain('1,900 passages left');
    expect(fetchIndexing).toHaveBeenCalledTimes(2);
  });

  it('goes away, and stops reading, once nothing is pending (matrix row "Nothing pending")', async () => {
    vi.useFakeTimers();
    fetchIndexing.mockResolvedValueOnce(count(100)).mockResolvedValueOnce(NONE).mockResolvedValue(count(50));
    const { container } = render(<IndexingNotice remaining={150} language="pt-BR" />);

    await tick();
    expect(line(container)!.textContent).toContain('faltam 100 trechos');
    await tick();
    expect(line(container)).toBeNull();
    await tick(5);
    expect(fetchIndexing).toHaveBeenCalledTimes(2);
    expect(line(container)).toBeNull();
  });

  it('stops reading after 10 minutes without a change, and the line stays (matrix row "Stuck")', async () => {
    vi.useFakeTimers();
    fetchIndexing.mockResolvedValueOnce(count(700)).mockResolvedValue(count(700));
    const { container } = render(<IndexingNotice remaining={800} language="pt-BR" />);

    await tick();
    expect(line(container)!.textContent).toContain('faltam 700 trechos');
    const polls = INDEXING_STALL_MS / INDEXING_POLL_MS;
    await tick(polls - 1);
    // Just under 10 minutes since the last change: still reading.
    expect(fetchIndexing).toHaveBeenCalledTimes(polls);
    await tick();
    expect(fetchIndexing).toHaveBeenCalledTimes(polls + 1);
    await tick(10);
    expect(fetchIndexing).toHaveBeenCalledTimes(polls + 1);
    expect(line(container)!.textContent).toContain('faltam 700 trechos');
  });

  it('says "falta 1 trecho" / "1 passage left" for the last passage', () => {
    for (const [language, text] of [
      ['pt-BR', 'Preparando as fontes para busca: falta 1 trecho'],
      ['en', 'Preparing your sources for search: 1 passage left'],
    ] as const) {
      const { container } = render(<IndexingNotice remaining={1} language={language} />);
      expect(line(container)!.textContent).toContain(text);
      cleanup();
    }
  });

  it('a failed read never counts towards the 10 minutes: after more than 10 minutes of failures a new count shows', async () => {
    vi.useFakeTimers();
    fetchIndexing.mockResolvedValue(FAILED);
    const { container } = render(<IndexingNotice remaining={800} language="pt-BR" />);

    const polls = INDEXING_STALL_MS / INDEXING_POLL_MS;
    await tick(polls + 10);
    expect(fetchIndexing).toHaveBeenCalledTimes(polls + 10);
    expect(line(container)!.textContent).toContain('faltam 800 trechos');
    fetchIndexing.mockResolvedValueOnce(count(600));
    await tick();
    expect(line(container)!.textContent).toContain('faltam 600 trechos');
    // Failures in between unchanged reads do not count either: still reading after 10 more minutes of mixed reads.
    fetchIndexing.mockImplementation(async () => (fetchIndexing.mock.calls.length % 2 === 0 ? FAILED : count(600)));
    await tick(polls + 2);
    expect(fetchIndexing).toHaveBeenCalledTimes(2 * polls + 13);
  });

  it('a read that never settles counts as failed, and the next read goes ahead', async () => {
    vi.useFakeTimers();
    const signals: (AbortSignal | undefined)[] = [];
    fetchIndexing.mockImplementationOnce((signal) => {
      signals.push(signal);
      return new Promise<IndexingPoll>(() => undefined);
    }).mockResolvedValueOnce(count(1500));
    const { container } = render(<IndexingNotice remaining={2000} language="pt-BR" />);

    await tick();
    expect(fetchIndexing).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(INDEXING_READ_TIMEOUT_MS));
    expect(signals[0]!.aborted).toBe(true);
    expect(line(container)!.textContent).toContain('faltam 2.000 trechos');
    await act(() => vi.advanceTimersByTimeAsync(INDEXING_POLL_MS - INDEXING_READ_TIMEOUT_MS));
    expect(fetchIndexing).toHaveBeenCalledTimes(2);
    expect(line(container)!.textContent).toContain('faltam 1.500 trechos');
  });

  it('a new count from the page shows again after a null read hid the notice, and the reads start again', async () => {
    vi.useFakeTimers();
    fetchIndexing.mockResolvedValueOnce(NONE).mockResolvedValue(count(300));
    const { container, rerender } = render(<IndexingNotice remaining={500} language="pt-BR" />);
    await tick();
    expect(line(container)).toBeNull();
    await tick(3);
    expect(fetchIndexing).toHaveBeenCalledTimes(1);

    // The tray or a material's page refreshed the layout: it renders the notice in place with a new count.
    rerender(<IndexingNotice remaining={400} language="pt-BR" />);
    expect(line(container)!.textContent).toContain('faltam 400 trechos');
    await tick();
    expect(fetchIndexing).toHaveBeenCalledTimes(2);
    expect(line(container)!.textContent).toContain('faltam 300 trechos');
  });

  it('a new count from the page shows after a stall, and the reads and the 10 minutes start again', async () => {
    vi.useFakeTimers();
    fetchIndexing.mockResolvedValue(count(700));
    const { container, rerender } = render(<IndexingNotice remaining={700} language="pt-BR" />);
    const polls = INDEXING_STALL_MS / INDEXING_POLL_MS;
    await tick(polls + 5);
    expect(fetchIndexing).toHaveBeenCalledTimes(polls);

    rerender(<IndexingNotice remaining={650} language="pt-BR" />);
    expect(line(container)!.textContent).toContain('faltam 650 trechos');
    fetchIndexing.mockResolvedValue(count(650));
    await tick(polls - 1);
    expect(fetchIndexing).toHaveBeenCalledTimes(2 * polls - 1);
    await tick(5);
    expect(fetchIndexing).toHaveBeenCalledTimes(2 * polls);
    expect(line(container)!.textContent).toContain('faltam 650 trechos');
  });

  it('does not read while the tab is hidden, and reads again once it is visible', async () => {
    vi.useFakeTimers();
    fetchIndexing.mockResolvedValue(count(10));
    const { container } = render(<IndexingNotice remaining={20} language="pt-BR" />);

    setVisibility('hidden');
    await tick(3);
    expect(fetchIndexing).not.toHaveBeenCalled();
    setVisibility('visible');
    await tick();
    expect(fetchIndexing).toHaveBeenCalledTimes(1);
    expect(line(container)!.textContent).toContain('faltam 10 trechos');
  });

  it('stops reading once it leaves the page', async () => {
    vi.useFakeTimers();
    fetchIndexing.mockResolvedValue(count(10));
    const { unmount } = render(<IndexingNotice remaining={20} language="pt-BR" />);
    unmount();
    await tick(3);
    expect(fetchIndexing).not.toHaveBeenCalled();
  });
});

function memoryStorage(): UrlStorage {
  return {
    findAllUploads: async () => [],
    findUploadsByFingerprint: async () => [],
    removeUpload: async () => undefined,
    addUpload: async () => 'key',
  };
}

/** A stream the test writes events into, as the backend would. */
class FakeStream extends EventTarget {
  readyState = 1;
  close(): void {
    this.readyState = 2;
  }
  emit(name: string, data: unknown, id: number): void {
    act(() => {
      this.dispatchEvent(new MessageEvent(name, { data: JSON.stringify(data), lastEventId: String(id) }));
    });
  }
}

describe('the indexing notice on the questions page (matrix row "Questions page")', () => {
  it('reads its count while the turns stay on the screen, untouched', async () => {
    const streams: FakeStream[] = [];
    const { container } = render(
      <UploadsProvider texts={uploadTexts('pt-BR')} belonging={null} urlStorage={memoryStorage()}>
        <IndexingNotice remaining={2000} language="pt-BR" />
        <Conversation
          language="pt-BR"
          campaignId={CAMPAIGN}
          hasSources
          review={null}
          openStream={(url) => {
            const stream = new FakeStream();
            void url;
            streams.push(stream);
            return stream as unknown as EventSource;
          }}
        />
      </UploadsProvider>,
    );
    postQuestion.mockResolvedValueOnce({ ok: true, turn: { id: TURN, conversationId: 'c', language: 'pt-BR' } });
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox'), 'Quanto dano causa Fire Bolt?{Enter}');
    await waitFor(() => expect(streams).toHaveLength(1));
    streams[0]!.emit('delta', { text: 'Um d10 de dano de fogo.' }, 1);
    streams[0]!.emit('citation', { passageId: PASSAGE, offset: 23 }, 2);
    streams[0]!.emit('done', {
      stopped: false,
      silent: false,
      references: [{ number: 1, materialName: 'SRD.pdf', sectionPath: ['Magias'], page: 3, passageIds: [PASSAGE], removed: false }],
    }, 3);
    const turns = within(screen.getAllByRole('list')[0]!);
    const question = turns.getByText('Quanto dano causa Fire Bolt?');
    expect(turns.getByText('Um d10 de dano de fogo.')).toBeTruthy();

    // The notice now reads its count (its timer set again under fake timers as the tab comes back), and one read
    // fails, like a 503.
    vi.useFakeTimers();
    setVisibility('hidden');
    setVisibility('visible');
    fetchIndexing.mockResolvedValueOnce(count(1800)).mockResolvedValueOnce(FAILED).mockResolvedValueOnce(count(1200));
    await tick(3);

    expect(fetchIndexing).toHaveBeenCalledTimes(3);
    expect(line(container)!.textContent).toContain('faltam 1.200 trechos');
    // The same turn, the same nodes: nothing was re-rendered away, and the page was never refreshed.
    expect(turns.getByText('Quanto dano causa Fire Bolt?')).toBe(question);
    expect(turns.getByText('Um d10 de dano de fogo.')).toBeTruthy();
    expect(turns.getByText('SRD.pdf, Magias, p. 3', { exact: false })).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });
});
