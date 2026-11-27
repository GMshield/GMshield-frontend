import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Story 5.7 part A: "Exportar" on an artifact's page, its formats, the download and the toasts. Part B: "Exportar" above
 * the lists, whose dialog ticks the rows of the page shown and exports them through the same routine.
 */
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => '/campaigns/x/artifacts/y',
  useRouter: () => ({ refresh: () => undefined, push: () => undefined, replace: () => undefined, prefetch: () => undefined }),
}));

const { ArtifactExport } = await import('@/components/artifacts/ArtifactExport');
const { ArtifactExportDialog } = await import('@/components/artifacts/ArtifactExportDialog');
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

// jsdom has no modal dialogs: the smallest stand-in for showModal() and close().
beforeAll(() => {
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

  it('several ids go in their order; with no file name from the relay, the file is named "artifacts" in English (Story 5.7 part B)', async () => {
    const user = userEvent.setup();
    answerWith(file('zip', null, 'application/zip'));
    renderExport('en', [SHIELD, SWORD]);

    await user.click(screen.getByRole('button', { name: en.artifacts.export.action }));
    await user.click(screen.getByRole('button', { name: en.artifacts.export.jpg }));

    expect(fetched[0]!.url).toBe(`/api/v1/campaigns/${CAMPAIGN}/artifacts/export?ids=${SHIELD}%2C${SWORD}&format=jpg`);
    expect(downloads).toEqual([{ name: 'artifacts.zip', href: 'blob:export-1' }]);
    expect(within(toasts('Messages')).getByRole('status').textContent).toContain('Export ready: artifacts.zip.');
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

describe('"Exportar" above a list (Story 5.7 part B)', () => {
  const CROWN = '0190a0b0-0000-7000-8000-000000000910';
  const BOOTS = '0190a0b0-0000-7000-8000-000000000911';
  const CLOAK = '0190a0b0-0000-7000-8000-000000000912';
  /** The tab's page [C, B, A]: the first shared into the campaign, the last with no detail (as in "Personagens"). */
  const ROWS = [
    { id: CROWN, label: 'Coroa', detail: 'Item · Compartilhado de A Coroa Partida' },
    { id: BOOTS, label: 'Botas', detail: 'Item' },
    { id: CLOAK, label: 'Capa', detail: null },
  ];
  const pressed = (button: HTMLElement) => button.getAttribute('aria-pressed');

  function renderDialog(language: 'pt-BR' | 'en' = 'pt-BR', rows = ROWS) {
    return render(
      <NotificationsProvider language={language}>
        <ArtifactExportDialog campaignId={CAMPAIGN} rows={rows} language={language} />
      </NotificationsProvider>,
    );
  }

  async function openDialog(user: ReturnType<typeof userEvent.setup>, messages = ptBR) {
    await user.click(screen.getByRole('button', { name: messages.artifacts.export.action }));
    return screen.getByRole('dialog', { name: messages.artifacts.export.title });
  }

  const box = (dialog: HTMLElement, name: string) => within(dialog).getByRole('checkbox', { name }) as HTMLInputElement;
  /** The line under the rows that describes "Exportar": why it is unavailable, else how many rows are ticked. */
  const tally = (dialog: HTMLElement, messages = ptBR) => {
    const confirm = within(dialog).getByRole('button', { name: messages.artifacts.export.action });
    const line = document.getElementById(confirm.getAttribute('aria-describedby') ?? '');
    expect(line?.getAttribute('aria-live')).toBe('polite');
    expect(dialog.contains(line)).toBe(true);
    return line?.textContent;
  };

  it('opens on "Cancelar" with the rows in list order, none ticked, PDF chosen and "Exportar" unavailable', async () => {
    const user = userEvent.setup();
    const { container } = renderDialog();
    const pill = screen.getByRole('button', { name: ptBR.artifacts.export.action });
    expect(pill.getAttribute('aria-haspopup')).toBe('dialog');

    const dialog = await openDialog(user);
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(dialog.textContent).toContain(ptBR.artifacts.export.consequence);
    const list = within(dialog).getByRole('group', { name: ptBR.artifacts.export.legend });
    // Each checkbox is named by the row's name and detail; a row with no detail by its name.
    const boxes = within(list).getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes.map((each) => each.getAttribute('aria-label'))).toEqual(['Coroa, Item · Compartilhado de A Coroa Partida', 'Botas, Item', 'Capa']);
    expect(boxes.map((each) => each.checked)).toEqual([false, false, false]);
    expect(within(list).getAllByRole('listitem').map((row) => row.textContent)).toEqual(['CoroaItem · Compartilhado de A Coroa Partida', 'BotasItem', 'Capa']);
    expect(pressed(within(list).getByRole('button', { name: ptBR.artifacts.export.clear }))).toBe('true');
    expect(pressed(within(list).getByRole('button', { name: ptBR.artifacts.export.selectAll }))).toBe('false');

    const formats = within(dialog).getByRole('group', { name: ptBR.artifacts.export.formatLegend });
    const radios = within(formats).getAllByRole('radio') as HTMLInputElement[];
    expect(radios.map((radio) => radio.labels?.[0]?.textContent)).toEqual(['PDF', 'Texto (TXT)', 'Markdown', 'Imagem (JPG)']);
    expect(radios.map((radio) => radio.checked)).toEqual([true, false, false, false]);
    expect(dialog.textContent).not.toContain(ptBR.artifacts.export.zipNote);

    const confirm = within(dialog).getByRole('button', { name: ptBR.artifacts.export.action });
    expect(confirm.getAttribute('aria-disabled')).toBe('true');
    // Why it is unavailable, as the button's description.
    expect(tally(dialog)).toBe('Marque ao menos um artefato para exportar.');
    await user.click(confirm);
    expect(fetched).toEqual([]);
    expect((container.querySelector('dialog') as HTMLDialogElement).open).toBe(true);
    expect(container.querySelectorAll('[style]')).toHaveLength(0);
  });

  it('two ticked, as PDF: their ids go in list order, the file falls back to "artefatos.pdf", the dialog closes on the pill and a toast names it', async () => {
    const user = userEvent.setup();
    answerWith(file('%PDF', null));
    const { container } = renderDialog();
    const dialog = await openDialog(user);
    // Ticked out of order: the list's order is what goes.
    await user.click(box(dialog, 'Capa'));
    expect(tally(dialog)).toBe('1 de 3 marcado');
    await user.click(box(dialog, 'Botas, Item'));
    expect(tally(dialog)).toBe('2 de 3 marcados');
    expect(within(dialog).getByRole('button', { name: ptBR.artifacts.export.action }).getAttribute('aria-disabled')).toBeNull();
    expect(pressed(within(dialog).getByRole('button', { name: ptBR.artifacts.export.clear }))).toBe('false');

    await user.click(within(dialog).getByRole('button', { name: ptBR.artifacts.export.action }));

    expect(fetched.map((call) => call.url)).toEqual([`/api/v1/campaigns/${CAMPAIGN}/artifacts/export?ids=${BOOTS}%2C${CLOAK}&format=pdf`]);
    expect(downloads).toEqual([{ name: 'artefatos.pdf', href: 'blob:export-1' }]);
    expect(within(toasts()).getByRole('status').textContent).toContain('Exportação pronta: artefatos.pdf.');
    expect((container.querySelector('dialog') as HTMLDialogElement).open).toBe(false);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: ptBR.artifacts.export.action }));
  });

  it('"Selecionar todos" ticks every row and "Limpar seleção" none; all of them as JPG come as "artefatos.zip", with the zip note', async () => {
    const user = userEvent.setup();
    answerWith(file('zip', null, 'application/zip'));
    renderDialog();
    const dialog = await openDialog(user);
    const selectAll = within(dialog).getByRole('button', { name: ptBR.artifacts.export.selectAll });
    const clear = within(dialog).getByRole('button', { name: ptBR.artifacts.export.clear });

    await user.click(selectAll);
    expect((within(dialog).getAllByRole('checkbox') as HTMLInputElement[]).map((each) => each.checked)).toEqual([true, true, true]);
    expect([pressed(selectAll), pressed(clear)]).toEqual(['true', 'false']);
    expect(tally(dialog)).toBe('3 de 3 marcados');
    await user.click(clear);
    expect((within(dialog).getAllByRole('checkbox') as HTMLInputElement[]).map((each) => each.checked)).toEqual([false, false, false]);
    expect([pressed(selectAll), pressed(clear)]).toEqual(['false', 'true']);
    expect(tally(dialog)).toBe(ptBR.artifacts.export.tickNone);
    expect(within(dialog).getByRole('button', { name: ptBR.artifacts.export.action }).getAttribute('aria-disabled')).toBe('true');
    await user.click(selectAll);

    const jpg = within(dialog).getByRole('radio', { name: 'Imagem (JPG)' });
    await user.click(jpg);
    expect(dialog.textContent).toContain(ptBR.artifacts.export.zipNote);
    expect(jpg.getAttribute('aria-describedby')).not.toBeNull();
    expect(document.getElementById(jpg.getAttribute('aria-describedby') ?? '')?.textContent).toBe(ptBR.artifacts.export.zipNote);
    await user.click(within(dialog).getByRole('button', { name: ptBR.artifacts.export.action }));

    expect(fetched[0]!.url).toBe(`/api/v1/campaigns/${CAMPAIGN}/artifacts/export?ids=${CROWN}%2C${BOOTS}%2C${CLOAK}&format=jpg`);
    expect(downloads).toEqual([{ name: 'artefatos.zip', href: 'blob:export-1' }]);
  });

  it('one ticked (a shared row): its id alone, the file named after it; with no name from the relay, "artefato"', async () => {
    const user = userEvent.setup();
    answerWith(file('# Coroa', "attachment; filename=\"Coroa.md\"; filename*=UTF-8''Coroa.md", 'text/markdown'));
    renderDialog();
    let dialog = await openDialog(user);
    await user.click(box(dialog, 'Coroa, Item · Compartilhado de A Coroa Partida'));
    await user.click(within(dialog).getByRole('radio', { name: 'Markdown' }));
    await user.click(within(dialog).getByRole('button', { name: ptBR.artifacts.export.action }));
    expect(fetched[0]!.url).toBe(`/api/v1/campaigns/${CAMPAIGN}/artifacts/export?ids=${CROWN}&format=markdown`);
    expect(downloads).toEqual([{ name: 'Coroa.md', href: 'blob:export-1' }]);

    answerWith(file('texto', null, 'text/plain'));
    dialog = await openDialog(user);
    await user.click(box(dialog, 'Capa'));
    await user.click(within(dialog).getByRole('radio', { name: 'Texto (TXT)' }));
    await user.click(within(dialog).getByRole('button', { name: ptBR.artifacts.export.action }));
    expect(downloads.at(-1)).toEqual({ name: 'artefato.txt', href: 'blob:export-1' });
  });

  it('two sheets as TXT ("Personagens"): one .txt for the campaign given, in English', async () => {
    const user = userEvent.setup();
    answerWith(file('text', null, 'text/plain'));
    renderDialog('en', [
      { id: BOOTS, label: 'Lyra', detail: null },
      { id: CLOAK, label: 'Kael', detail: null },
    ]);
    const dialog = await openDialog(user, en);
    expect(tally(dialog, en)).toBe('Tick at least one artifact to export.');
    await user.click(within(dialog).getByRole('checkbox', { name: 'Lyra' }));
    expect(tally(dialog, en)).toBe('1 of 2 ticked');
    await user.click(within(dialog).getByRole('button', { name: en.artifacts.export.selectAll }));
    expect(tally(dialog, en)).toBe('2 of 2 ticked');
    await user.click(within(dialog).getByRole('radio', { name: en.artifacts.export.txt }));
    await user.click(within(dialog).getByRole('button', { name: en.artifacts.export.action }));
    expect(fetched[0]!.url).toBe(`/api/v1/campaigns/${CAMPAIGN}/artifacts/export?ids=${BOOTS}%2C${CLOAK}&format=txt`);
    expect(downloads).toEqual([{ name: 'artifacts.txt', href: 'blob:export-1' }]);
    expect(within(toasts('Messages')).getByRole('status').textContent).toContain('Export ready: artifacts.txt.');
  });

  it('by keyboard: Tab reaches every control and stays inside; Space ticks, arrows choose a format, Enter exports; reopened, nothing is ticked and PDF is chosen again', async () => {
    const user = userEvent.setup();
    answerWith(file('texto', null, 'text/plain'));
    renderDialog();
    const pill = screen.getByRole('button', { name: ptBR.artifacts.export.action });
    await user.tab();
    expect(document.activeElement).toBe(pill);
    await user.keyboard('{Enter}');
    const dialog = screen.getByRole('dialog', { name: ptBR.artifacts.export.title });
    const cancel = within(dialog).getByRole('button', { name: 'Cancelar' });
    const confirm = within(dialog).getByRole('button', { name: ptBR.artifacts.export.action });
    expect(document.activeElement).toBe(cancel);

    await user.tab();
    expect(document.activeElement).toBe(confirm);
    // Past the last control, back to the first: the quick choices, each row, the chosen format, then the buttons.
    const order = [
      within(dialog).getByRole('button', { name: ptBR.artifacts.export.selectAll }),
      within(dialog).getByRole('button', { name: ptBR.artifacts.export.clear }),
      ...within(dialog).getAllByRole('checkbox'),
      within(dialog).getByRole('radio', { name: 'PDF' }),
      cancel,
      confirm,
    ];
    for (const control of order) {
      await user.tab();
      expect(document.activeElement).toBe(control);
    }
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(cancel);

    // Escape closes on the pill; reopened, it starts afresh.
    box(dialog, 'Botas, Item').focus();
    await user.keyboard(' ');
    expect(box(dialog, 'Botas, Item').checked).toBe(true);
    await user.keyboard('{Escape}');
    expect(document.activeElement).toBe(pill);
    expect(fetched).toEqual([]);
    await user.keyboard('{Enter}');
    expect(box(dialog, 'Botas, Item').checked).toBe(false);

    box(dialog, 'Botas, Item').focus();
    await user.keyboard(' ');
    within(dialog).getByRole('radio', { name: 'PDF' }).focus();
    await user.keyboard('{ArrowRight}');
    expect((within(dialog).getByRole('radio', { name: 'Texto (TXT)' }) as HTMLInputElement).checked).toBe(true);
    confirm.focus();
    await user.keyboard('{Enter}');
    expect(fetched.map((call) => call.url)).toEqual([`/api/v1/campaigns/${CAMPAIGN}/artifacts/export?ids=${BOOTS}&format=txt`]);
    expect(document.activeElement).toBe(pill);

    await user.keyboard('{Enter}');
    expect((within(dialog).getByRole('radio', { name: 'PDF' }) as HTMLInputElement).checked).toBe(true);
    expect((within(dialog).getAllByRole('checkbox') as HTMLInputElement[]).every((each) => !each.checked)).toBe(true);
  });

  it('a refusal of several is a toast in the plural: one gone, too long, busy, in both languages; nothing is downloaded', async () => {
    const user = userEvent.setup();
    for (const [language, messages, region] of [['pt-BR', ptBR, 'Avisos'], ['en', en, 'Messages']] as const) {
      for (const [code, status, text] of [
        ['request.not_found', 404, messages.artifacts.export.notFoundSeveral],
        ['artifact.export_too_large', 400, messages.artifacts.export.tooLargeSeveral],
        ['artifact.export_busy', 503, messages.artifacts.export.busy],
      ] as const) {
        cleanup();
        answerWith(refusal(status, code));
        renderDialog(language);
        const dialog = await openDialog(user, messages);
        await user.click(within(dialog).getByRole('button', { name: messages.artifacts.export.selectAll }));
        await user.click(within(dialog).getByRole('button', { name: messages.artifacts.export.action }));
        expect(within(toasts(region)).getByRole('alert').textContent).toContain(text);
        expect(downloads).toEqual([]);
      }
    }
    expect(ptBR.artifacts.export.notFoundSeveral).toMatch(/^Um dos artefatos escolhidos/);
    expect(ptBR.artifacts.export.tooLargeSeveral).toContain('200 páginas');
    expect(ptBR.artifacts.export.tooLargeSeveral).toContain('TXT ou Markdown');
    expect(en.artifacts.export.notFoundSeveral).toMatch(/^One of the chosen artifacts/);
  });

  it('one ticked and gone keeps part A\'s singular message', async () => {
    const user = userEvent.setup();
    answerWith(refusal(404, 'request.not_found'));
    renderDialog();
    const dialog = await openDialog(user);
    await user.click(box(dialog, 'Capa'));
    await user.click(within(dialog).getByRole('button', { name: ptBR.artifacts.export.action }));
    expect(within(toasts()).getByRole('alert').textContent).toContain(ptBR.artifacts.export.notFound);
  });

  it('while the file is read, the pill is busy and ignores presses', async () => {
    const user = userEvent.setup();
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
    const { container } = renderDialog();
    const dialog = await openDialog(user);
    await user.click(box(dialog, 'Capa'));
    await user.click(within(dialog).getByRole('button', { name: ptBR.artifacts.export.action }));
    const pill = screen.getByRole('button', { name: ptBR.artifacts.export.action });
    expect(pill.getAttribute('aria-busy')).toBe('true');
    expect(pill.getAttribute('aria-disabled')).toBe('true');
    await user.click(pill);
    expect((container.querySelector('dialog') as HTMLDialogElement).open).toBe(false);

    await act(async () => {
      release(file('%PDF', 'attachment; filename="Capa.pdf"'));
    });
    expect(pill.getAttribute('aria-busy')).toBeNull();
    expect(downloads).toEqual([{ name: 'Capa.pdf', href: 'blob:export-1' }]);
  });
});
