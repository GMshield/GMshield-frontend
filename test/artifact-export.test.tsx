import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Story 5.7 part A: "Exportar" on an artifact's page, its formats, the download and the toasts. */
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => '/campaigns/x/artifacts/y',
  useRouter: () => ({ refresh: () => undefined, push: () => undefined, replace: () => undefined, prefetch: () => undefined }),
}));

const { ArtifactExport } = await import('@/components/artifacts/ArtifactExport');
const { NotificationsProvider } = await import('@/components/notifications/NotificationsProvider');
const ptBR = (await import('@/messages/pt-BR.json')).default;
const en = (await import('@/messages/en.json')).default;

const CAMPAIGN = '0190a0b0-0000-7000-8000-000000000002';
const SWORD = '0190a0b0-0000-7000-8000-000000000900';
const SHIELD = '0190a0b0-0000-7000-8000-000000000901';

type Fetched = { url: string; init: RequestInit | undefined };
let fetched: Fetched[] = [];
let downloads: { name: string; href: string }[] = [];
let revoked: string[] = [];

function answerWith(response: Response | Error) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      fetched.push({ url, init });
      if (response instanceof Error) {
        throw response;
      }
      return response;
    }),
  );
}

function file(body: string, disposition: string | null, type = 'application/pdf'): Response {
  const headers: Record<string, string> = { 'content-type': type };
  if (disposition !== null) {
    headers['content-disposition'] = disposition;
  }
  return new Response(body, { status: 200, headers });
}

function refusal(status: number, code: string): Response {
  return new Response(JSON.stringify({ status, category: code.split('.')[0], code, params: {} }), {
    status,
    headers: { 'content-type': 'application/problem+json' },
  });
}

function renderExport(language: 'pt-BR' | 'en' = 'pt-BR', ids: readonly string[] = [SWORD]) {
  return render(
    <NotificationsProvider language={language}>
      <ArtifactExport campaignId={CAMPAIGN} ids={ids} language={language} />
    </NotificationsProvider>,
  );
}

const toasts = (name = 'Avisos') => screen.getByRole('region', { name });

beforeEach(() => {
  fetched = [];
  downloads = [];
  revoked = [];
  vi.stubGlobal('URL', Object.assign(globalThis.URL, {
    createObjectURL: vi.fn(() => 'blob:export-1'),
    revokeObjectURL: vi.fn((href: string) => revoked.push(href)),
  }));
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push({ name: this.download, href: this.getAttribute('href') ?? '' });
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('"Exportar" (Story 5.7 part A)', () => {
  it('a pill opens the four formats; by keyboard every format is reachable, Esc closes and gives focus back', async () => {
    const user = userEvent.setup();
    renderExport();
    const pill = screen.getByRole('button', { name: ptBR.artifacts.export.action });
    expect(pill.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('list', { name: ptBR.artifacts.export.menu })).toBeNull();

    await user.tab();
    expect(document.activeElement).toBe(pill);
    await user.keyboard('{Enter}');
    expect(pill.getAttribute('aria-expanded')).toBe('true');
    const list = screen.getByRole('list', { name: ptBR.artifacts.export.menu });
    const formats = within(list).getAllByRole('button');
    expect(formats.map((button) => button.textContent)).toEqual(['PDF', 'Texto (TXT)', 'Markdown', 'Imagem (JPG)']);
    for (const format of formats) {
      await user.tab();
      expect(document.activeElement).toBe(format);
    }
    await user.keyboard('{Escape}');
    expect(pill.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(pill);
    expect(fetched).toEqual([]);
  });

  it('a format downloads the file through the relay under the name the backend gave, and a toast says it is ready', async () => {
    const user = userEvent.setup();
    answerWith(file('%PDF', "attachment; filename=\"Espada de Kael.pdf\"; filename*=UTF-8''Espada%20de%20Kael.pdf"));
    renderExport();

    await user.click(screen.getByRole('button', { name: ptBR.artifacts.export.action }));
    await user.click(screen.getByRole('button', { name: 'PDF' }));

    expect(fetched.map((call) => call.url)).toEqual([`/api/v1/campaigns/${CAMPAIGN}/artifacts/export?ids=${SWORD}&format=pdf`]);
    expect(fetched[0]!.init).toMatchObject({ credentials: 'same-origin', cache: 'no-store' });
    expect(downloads).toEqual([{ name: 'Espada de Kael.pdf', href: 'blob:export-1' }]);
    const said = within(toasts()).getByRole('status');
    expect(said.textContent).toContain(ptBR.artifacts.export.done.replace('{file}', 'Espada de Kael.pdf'));
    // The list closed, and focus went back to the pill.
    expect(screen.getByRole('button', { name: ptBR.artifacts.export.action }).getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: ptBR.artifacts.export.action }));
  });

  it('several ids go in their order; with no file name from the relay, the file is named "artifact" in English', async () => {
    const user = userEvent.setup();
    answerWith(file('zip', null, 'application/zip'));
    renderExport('en', [SHIELD, SWORD]);

    await user.click(screen.getByRole('button', { name: en.artifacts.export.action }));
    await user.click(screen.getByRole('button', { name: en.artifacts.export.jpg }));

    expect(fetched[0]!.url).toBe(`/api/v1/campaigns/${CAMPAIGN}/artifacts/export?ids=${SHIELD}%2C${SWORD}&format=jpg`);
    expect(downloads).toEqual([{ name: 'artifact.zip', href: 'blob:export-1' }]);
    expect(within(toasts('Messages')).getByRole('status').textContent).toContain('Export ready: artifact.zip.');
  });

  it('an artifact no longer readable, or a failure, is an error toast that says why; nothing is downloaded', async () => {
    const user = userEvent.setup();
    answerWith(refusal(404, 'request.not_found'));
    renderExport();

    await user.click(screen.getByRole('button', { name: ptBR.artifacts.export.action }));
    await user.click(screen.getByRole('button', { name: 'Markdown' }));

    expect(within(toasts()).getByRole('alert').textContent).toContain(ptBR.artifacts.export.notFound);
    expect(downloads).toEqual([]);

    cleanup();
    answerWith(new TypeError('offline'));
    renderExport();
    await user.click(screen.getByRole('button', { name: ptBR.artifacts.export.action }));
    await user.click(screen.getByRole('button', { name: 'Texto (TXT)' }));
    expect(within(toasts()).getByRole('alert').textContent).toContain(ptBR.errors.codes.server.unavailable);
    expect(downloads).toEqual([]);
  });

  it('an export too long for PDF or JPG, or one while others run, says so in its toast, in both languages', async () => {
    const user = userEvent.setup();
    for (const [language, messages, region] of [['pt-BR', ptBR, 'Avisos'], ['en', en, 'Messages']] as const) {
      for (const [code, status, text] of [
        ['artifact.export_too_large', 400, messages.artifacts.export.tooLarge],
        ['artifact.export_busy', 503, messages.artifacts.export.busy],
      ] as const) {
        cleanup();
        answerWith(refusal(status, code));
        renderExport(language);
        await user.click(screen.getByRole('button', { name: messages.artifacts.export.action }));
        await user.click(screen.getByRole('button', { name: 'PDF' }));
        expect(within(toasts(region)).getByRole('alert').textContent).toContain(text);
        expect(downloads).toEqual([]);
      }
    }
    expect(ptBR.artifacts.export.tooLarge).toContain('TXT ou Markdown');
    expect(en.artifacts.export.busy).toContain('Try again');
  });

  it('while the file is read, the pill is busy and ignores presses; the object address is let go afterwards', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    let release: (response: Response) => void = () => undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        fetched.push({ url, init });
        return new Promise<Response>((resolve) => {
          release = resolve;
        });
      }),
    );
    renderExport();
    const pill = screen.getByRole('button', { name: ptBR.artifacts.export.action });

    await user.click(pill);
    await user.click(screen.getByRole('button', { name: 'PDF' }));
    expect(pill.getAttribute('aria-busy')).toBe('true');
    expect(pill.getAttribute('aria-disabled')).toBe('true');
    await user.click(pill);
    expect(pill.getAttribute('aria-expanded')).toBe('false');

    await act(async () => {
      release(file('%PDF', 'attachment; filename="Espada de Kael.pdf"'));
    });
    expect(pill.getAttribute('aria-busy')).toBeNull();
    expect(downloads).toHaveLength(1);
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(revoked).toEqual(['blob:export-1']);
  });

  it('has the same messages in both languages', () => {
    expect(Object.keys(en.artifacts.export)).toEqual(Object.keys(ptBR.artifacts.export));
  });
});
