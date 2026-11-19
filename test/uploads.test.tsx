import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PreviousUpload, UrlStorage } from 'tus-js-client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { UploadOptions, UploadResult } from '@/client/upload';
import type { ImageSetCalls, ImageSetCreate, SetCallResult } from '@/components/uploads/types';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  usePathname: () => '/questions',
  useRouter: () => ({ refresh }),
}));

/** One call of the browser upload module, controlled by the test. */
type FakeUpload = {
  readonly file: File;
  readonly options: UploadOptions;
  readonly aborted: boolean;
  created(id: string): void;
  progress(sent: number): void;
  finish(materialId: string): void;
  fail(status: number | null, problem: unknown): void;
};
const uploads: FakeUpload[] = [];

vi.mock('@/client/upload', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/client/upload')>();
  return {
    ...real,
    startUpload: (file: File, options: UploadOptions) => {
      let resolve: (result: UploadResult) => void = () => undefined;
      let reject: (error: unknown) => void = () => undefined;
      const done = new Promise<UploadResult>((yes, no) => {
        resolve = yes;
        reject = no;
      });
      const fake = {
        file,
        options,
        aborted: false,
        created: (id: string) => act(() => options.onUploadUrl?.(`http://localhost/api/v1/uploads/${id}`)),
        progress: (sent: number) => act(() => options.onProgress?.(sent, file.size)),
        finish: (materialId: string) => {
          resolve({ materialId, versionId: 'v', state: 'waiting', uploadUrl: 'u' });
        },
        fail: (status: number | null, problem: unknown) => reject(new real.UploadError('failed', status, problem)),
      };
      uploads.push(fake);
      return {
        done,
        abort: async () => {
          (fake as { aborted: boolean }).aborted = true;
        },
      };
    },
  };
});

const { Sidebar } = await import('@/components/Sidebar');
const { UploadsProvider, UPLOAD_LIFETIME_MS } = await import('@/components/uploads/UploadsProvider');
const { uploadTexts } = await import('@/components/uploads/upload-texts');
const { trayRows, REFRESH_MS } = await import('@/components/uploads/UploadTray');
const { MaterialRefresher } = await import('@/components/MaterialRefresher');
const { Conversation } = await import('@/components/conversation/Conversation');
const ptBR = (await import('@/messages/pt-BR.json')).default;
const en = (await import('@/messages/en.json')).default;

const BELONGING = {
  campaign: { id: '0190a0b0-0000-7000-8000-000000000002', name: 'Primeira campanha' },
  system: { id: '0190a0b0-0000-7000-8000-000000000001', name: 'Sistema sem nome' },
};
const LABELS = {
  name: 'GMshield',
  menu: 'Menu',
  openMenu: 'Abrir menu',
  closeMenu: 'Fechar menu',
  navigation: 'Navegação principal',
  currentCampaign: 'Campanha atual',
  entries: { questions: 'Consultas', rules: 'Criação de Regras', campaigns: 'Minhas Mesas', systems: 'Sistemas', characters: 'Personagens', files: 'Meus Arquivos', addFile: 'Adicionar Arquivo' },
};
type Material = Parameters<typeof trayRows>[0][number];

function memoryStorage(entries: (PreviousUpload & { urlStorageKey: string })[] = []): UrlStorage & { removed: string[] } {
  const removed: string[] = [];
  return {
    removed,
    findAllUploads: async () => entries.filter((entry) => !removed.includes(entry.urlStorageKey)),
    findUploadsByFingerprint: async () => [],
    removeUpload: async (key: string) => {
      removed.push(key);
    },
    addUpload: async () => 'k',
  };
}

/** The set calls (Story 1.21), recorded, with answers a test may script. */
type NextAnswers = { create?: SetCallResult<never>; replace?: SetCallResult<never>; drop?: SetCallResult<{ state: string }> };

function setCalls(): ImageSetCalls & { created: ImageSetCreate[]; replaced: unknown[][]; dropped: unknown[][]; next: NextAnswers } {
  const created: ImageSetCreate[] = [];
  const replaced: unknown[][] = [];
  const dropped: unknown[][] = [];
  const next: NextAnswers = {};
  return {
    created,
    replaced,
    dropped,
    next,
    create: async (request) => {
      created.push(request);
      if (next.create !== undefined) {
        return next.create;
      }
      const index = created.length;
      return {
        ok: true,
        data: {
          id: `set-${index}`,
          materialId: `material-${index}`,
          images: request.images.map((_image, position) => ({ position: position + 1, uploadId: `upload-${index}-${position + 1}` })),
        },
      };
    },
    replace: async (id, position, image) => {
      replaced.push([id, position, image]);
      return next.replace ?? { ok: true, data: { position, uploadId: `upload-again-${position}` } };
    },
    drop: async (id, position) => {
      dropped.push([id, position]);
      return next.drop ?? { ok: true, data: { state: 'waiting' } };
    },
  };
}

function view(
  options: { rows?: Material[]; storage?: UrlStorage; language?: 'pt-BR' | 'en'; belonging?: typeof BELONGING | null; sets?: ImageSetCalls } = {},
) {
  const storage = options.storage ?? memoryStorage();
  const tree = (rows: Material[]) => (
    <UploadsProvider
      texts={uploadTexts(options.language ?? 'pt-BR')}
      belonging={options.belonging === undefined ? BELONGING : options.belonging}
      urlStorage={storage}
      {...(options.sets === undefined ? {} : { imageSets: options.sets })}
    >
      <Sidebar labels={LABELS} campaign="Primeira campanha" initialState="open" menu={<p>menu</p>} trayRows={rows} />
    </UploadsProvider>
  );
  const rendered = render(tree(options.rows ?? []));
  return { ...rendered, rerenderRows: (rows: Material[]) => rendered.rerender(tree(rows)) };
}

/** A file whose first bytes are `head`, of `size` bytes in all. */
function fileOf(name: string, head: string | Uint8Array, size = 6000): File {
  const bytes = new Uint8Array(size);
  bytes.set(typeof head === 'string' ? new TextEncoder().encode(head) : head);
  return new File([bytes], name, { lastModified: 1 });
}

const pdf = (name = 'Livro do Jogador.pdf', size = 6000) => fileOf(name, '%PDF-1.7\n', size);
const jpeg = (name: string, size = 6000) => fileOf(name, new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), size);
const png = (name: string, size = 6000) => fileOf(name, new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), size);
const heic = (name: string, size = 6000) => fileOf(name, new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]), size);
/** A material's pages: `done` of `total`, with no layer sorted and no outcome unless `counts` gives them (Story 1.17). */
const pagesOf = (done: number, total: number, counts: Partial<NonNullable<Material['pages']>> = {}): NonNullable<Material['pages']> => ({
  done,
  total,
  text: { done: 0, total: 0 },
  image: { done: 0, total: 0 },
  readDirectly: 0,
  readByOcr: 0,
  unreadable: 0,
  reading: null,
  ...counts,
});
const polite = () => screen.getByTestId('uploads-polite').textContent ?? '';
const urgent = () => screen.getByTestId('uploads-urgent').textContent ?? '';
const dialog = () => screen.getByRole('dialog', { hidden: true }) as HTMLDialogElement;

async function choose(...files: File[]) {
  const input = screen.getByTestId('upload-files');
  fireEvent.change(input, { target: { files } });
  // Each file is checked (its first 4 KiB read) before the step lets the GM go on.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

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
  uploads.length = 0;
  refresh.mockClear();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('the guided upload (Story 1.14)', () => {
  it('opens from "Adicionar Arquivo", counts four steps, and sends the files with the answers', async () => {
    const user = userEvent.setup();
    const { container } = view();
    await user.click(screen.getByRole('button', { name: 'Adicionar Arquivo' }));

    const modal = screen.getByRole('dialog', { name: 'Adicionar arquivos' });
    expect((modal as HTMLDialogElement).open).toBe(true);
    expect(within(modal).getByText('Passo 1 de 4')).toBeTruthy();
    expect(document.activeElement).toBe(within(modal).getByRole('button', { name: 'Escolher arquivos' }));
    const next = within(modal).getByRole('button', { name: 'Próximo' }) as HTMLButtonElement;
    expect(next.disabled).toBe(true);

    await choose(pdf());
    expect(within(modal).getByText(/Pronto para enviar/).textContent).toContain('Livro do Jogador.pdf');
    expect(next.disabled).toBe(false);

    await user.click(next);
    expect(within(modal).getByText('Passo 2 de 4')).toBeTruthy();
    const kinds = within(modal).getAllByRole('radio');
    expect(kinds).toHaveLength(5);
    // Each choice is a full row: its label and a sentence that explains it.
    const supplement = within(modal).getByRole('radio', { name: /Suplemento/ });
    expect(supplement.closest('label')?.textContent).toContain('Mais regras e conteúdo para um sistema');
    expect(document.activeElement).toBe(within(modal).getByRole('radio', { name: /Livro de regras/ }));
    await user.click(supplement);

    await user.click(within(modal).getByRole('button', { name: 'Próximo' }));
    expect(within(modal).getByText('Passo 3 de 4')).toBeTruthy();
    expect(within(modal).getByRole('radio', { name: /Só em Primeira campanha/ })).toBeTruthy();
    await user.click(within(modal).getByRole('radio', { name: /Em todas as campanhas de Sistema sem nome/ }));

    await user.click(within(modal).getByRole('button', { name: 'Próximo' }));
    expect(within(modal).getByText('Passo 4 de 4')).toBeTruthy();
    expect(within(modal).getAllByRole('radio')).toHaveLength(3);
    await user.click(within(modal).getByRole('radio', { name: /Português/ }));
    await user.click(within(modal).getByRole('button', { name: 'Enviar' }));

    expect(within(modal).queryByText(/Passo/)).toBeNull();
    expect(within(modal).getByRole('heading', { name: 'Enviando' })).toBeTruthy();
    expect(uploads).toHaveLength(1);
    expect(uploads[0]!.options.metadata).toEqual({ kind: 'supplement', language: 'pt-BR', system: BELONGING.system.id });
    expect(uploads[0]!.options.resumeUrl).toBeUndefined();
    expect(container.querySelectorAll('[style]')).toHaveLength(0);
  });

  it('names each refused file with its reason and the accepted formats, says it at once, and never sends it', async () => {
    const user = userEvent.setup();
    view();
    await user.click(screen.getByRole('button', { name: 'Adicionar Arquivo' }));
    const huge = pdf('Enorme.pdf');
    Object.defineProperty(huge, 'size', { value: 3 * 1000 ** 3 });
    await choose(fileOf('campanha.zip', new Uint8Array([0x50, 0x4b, 3, 4])), huge, new File([], 'vazio.txt'));

    const modal = dialog();
    expect(modal.textContent).toContain('campanha.zip está num formato que o GMshield não aceita, então não será enviado. Use PDF, TXT, Markdown, JPG, PNG, WebP, TIFF, BMP ou HEIC.');
    expect(modal.textContent).toContain('Enorme.pdf tem mais de 2 GB');
    expect(modal.textContent).toContain('vazio.txt está vazio');
    expect(urgent()).toContain('vazio.txt está vazio');
    expect((within(modal).getByRole('button', { name: 'Próximo' }) as HTMLButtonElement).disabled).toBe(true);

    // A good file beside them: only it is sent.
    await choose(pdf());
    await user.click(within(modal).getByRole('button', { name: 'Remover campanha.zip' }));
    expect(modal.textContent).not.toContain('campanha.zip');
    for (let step = 0; step < 3; step++) {
      await user.click(within(modal).getByRole('button', { name: 'Próximo' }));
    }
    await user.click(within(modal).getByRole('button', { name: 'Enviar' }));
    expect(uploads.map((upload) => upload.file.name)).toEqual(['Livro do Jogador.pdf']);
  });

  it('keeps Tab inside, closes on Esc with focus back on "Adicionar Arquivo", and the upload goes on', async () => {
    const user = userEvent.setup();
    view();
    const add = screen.getByRole('button', { name: 'Adicionar Arquivo' });
    await user.click(add);
    const modal = dialog();
    const close = within(modal).getByRole('button', { name: 'Fechar' });
    const choose = within(modal).getByRole('button', { name: 'Escolher arquivos' });
    // The disabled "Próximo" is not a stop: past "Escolher arquivos", Tab comes back to "Fechar".
    await user.tab();
    expect(document.activeElement).toBe(close);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(choose);

    fireEvent.change(screen.getByTestId('upload-files'), { target: { files: [pdf()] } });
    await screen.findByText(/Pronto para enviar/);
    for (let step = 0; step < 3; step++) {
      await user.click(within(modal).getByRole('button', { name: 'Próximo' }));
    }
    await user.click(within(modal).getByRole('button', { name: 'Enviar' }));
    uploads[0]!.created('0190a0b0-0000-7000-8000-000000000005');
    uploads[0]!.progress(3000);

    await user.keyboard('{Escape}');
    expect(modal.open).toBe(false);
    expect(document.activeElement).toBe(add);
    expect(uploads[0]!.aborted).toBe(false);
    // The tray shows it moving, then waiting once the server has verified it.
    const tray = screen.getByRole('region', { name: 'Arquivos em andamento' });
    expect(within(tray).getByText('Livro do Jogador.pdf')).toBeTruthy();
    // Story 1.17: the pill names the upload with its own measure, on a solid line.
    expect(tray.querySelector('[data-state="uploading"]')!.textContent).toBe('enviando · 50%');
    expect((within(tray).getByRole('progressbar') as HTMLProgressElement).value).toBe(3000);
    expect(within(tray).getByRole('progressbar').getAttribute('data-phase')).toBe('upload');
    await act(async () => uploads[0]!.finish('0190a0b0-0000-7000-8000-000000000003'));
    expect(within(tray).getByText('aguardando')).toBeTruthy();
    expect(within(tray).getByRole('link', { name: 'Livro do Jogador.pdf' }).getAttribute('href')).toBe('/files/0190a0b0-0000-7000-8000-000000000003');
    expect(refresh).toHaveBeenCalled();
    // Opened again, it starts from the files.
    await user.click(add);
    expect(within(dialog()).getByText('Passo 1 de 4')).toBeTruthy();
    expect(within(dialog()).getByText('Nenhum arquivo escolhido ainda.')).toBeTruthy();
  });

  it('sends several files as several materials with the same answers, one after another', async () => {
    const user = userEvent.setup();
    view({ belonging: BELONGING });
    await user.click(screen.getByRole('button', { name: 'Adicionar Arquivo' }));
    await choose(pdf('a.pdf'), pdf('b.pdf'), new File(['# Notas\n'], 'c.md'));
    const modal = dialog();
    for (let step = 0; step < 3; step++) {
      await user.click(within(modal).getByRole('button', { name: 'Próximo' }));
    }
    await user.click(within(modal).getByRole('button', { name: 'Enviar' }));

    expect(uploads.map((upload) => upload.file.name)).toEqual(['a.pdf']);
    await act(async () => uploads[0]!.finish('m-a'));
    expect(uploads.map((upload) => upload.file.name)).toEqual(['a.pdf', 'b.pdf']);
    await act(async () => uploads[1]!.fail(415, { status: 415, category: 'upload', code: 'upload.format_refused' }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(uploads.map((upload) => upload.file.name)).toEqual(['a.pdf', 'b.pdf', 'c.md']);
    for (const upload of uploads) {
      expect(upload.options.metadata).toEqual({ kind: 'rulebook', language: 'detect', campaign: BELONGING.campaign.id });
    }
    // The server's refusal shows in the progress step, and is said at once.
    expect(modal.textContent).toContain('Este formato não é aceito');
    expect(urgent()).toContain('b.pdf: falhou.');
    const tray = screen.getByRole('region', { name: 'Arquivos em andamento' });
    expect(within(tray).getAllByRole('listitem')).toHaveLength(3);
  });

  it('without a campaign offers only "nowhere yet", and sends no belonging', async () => {
    const user = userEvent.setup();
    view({ belonging: null });
    await user.click(screen.getByRole('button', { name: 'Adicionar Arquivo' }));
    await choose(pdf());
    const modal = dialog();
    await user.click(within(modal).getByRole('button', { name: 'Próximo' }));
    await user.click(within(modal).getByRole('button', { name: 'Próximo' }));
    expect(within(modal).getAllByRole('radio').map((radio) => radio.closest('label')?.textContent)).toEqual([
      'Em nenhum lugar por enquantoVocê ainda não tem campanha, então o arquivo fica guardado sem uma.',
    ]);
    await user.click(within(modal).getByRole('button', { name: 'Próximo' }));
    await user.click(within(modal).getByRole('button', { name: 'Enviar' }));
    expect(uploads[0]!.options.metadata).toEqual({ kind: 'rulebook', language: 'detect' });
  });

  it('under 1280px, opening it closes the sidebar sheet first, so no dialog sits on another', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined }));
    try {
      view();
      const area = screen.getByTestId('sidebar').parentElement!;
      await user.click(screen.getByRole('button', { name: 'Abrir menu' }));
      expect(area.dataset.narrow).toBe('open');
      await user.click(screen.getByRole('button', { name: 'Adicionar Arquivo' }));
      expect(area.dataset.narrow).toBe('closed');
      expect(dialog().open).toBe(true);
      // The dialog is outside the sheet, which hides itself when closed.
      expect(screen.getByTestId('sidebar').contains(dialog())).toBe(false);
      // The closed sheet hides "Adicionar Arquivo": focus goes to the handle that opens it.
      const add = screen.getByRole('button', { name: 'Adicionar Arquivo', hidden: true });
      Object.defineProperty(add, 'checkVisibility', { configurable: true, value: () => false });
      await user.keyboard('{Escape}');
      expect(dialog().open).toBe(false);
      expect(area.dataset.narrow).toBe('closed');
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Abrir menu' }));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('follows a campaign that arrives while it stays mounted, and sends it', async () => {
    const user = userEvent.setup();
    const tree = (belonging: typeof BELONGING | null) => (
      <UploadsProvider texts={uploadTexts('pt-BR')} belonging={belonging} urlStorage={memoryStorage()}>
        <Sidebar labels={LABELS} campaign="Primeira campanha" initialState="open" menu={<p>menu</p>} trayRows={[]} />
      </UploadsProvider>
    );
    const { rerender } = render(tree(null));
    rerender(tree(BELONGING));
    await user.click(screen.getByRole('button', { name: 'Adicionar Arquivo' }));
    await choose(pdf());
    const modal = dialog();
    await user.click(within(modal).getByRole('button', { name: 'Próximo' }));
    await user.click(within(modal).getByRole('button', { name: 'Próximo' }));
    expect((within(modal).getByRole('radio', { name: /Só em Primeira campanha/ }) as HTMLInputElement).checked).toBe(true);
    await user.click(within(modal).getByRole('button', { name: 'Próximo' }));
    await user.click(within(modal).getByRole('button', { name: 'Enviar' }));
    expect(uploads[0]!.options.metadata).toEqual({ kind: 'rulebook', language: 'detect', campaign: BELONGING.campaign.id });
  });

  it('speaks English', async () => {
    const user = userEvent.setup();
    view({ language: 'en' });
    await user.click(screen.getByRole('button', { name: 'Adicionar Arquivo' }));
    expect(within(dialog()).getByText('Step 1 of 4')).toBeTruthy();
    expect(within(dialog()).getByRole('heading', { name: en.upload.dialog.title })).toBeTruthy();
  });
});

describe('the upload tray (Story 1.14)', () => {
  const ID = '0190a0b0-0000-7000-8000-000000000003';
  const UPLOAD = '0190a0b0-0000-7000-8000-000000000005';
  const interrupted = (expiresAt = new Date(Date.now() + 3 * 3600_000).toISOString()): Material => ({
    id: ID,
    name: 'Livro do Jogador.pdf',
    state: 'uploading',
    upload: { id: UPLOAD, offset: 2000, length: 6000, expiresAt },
  });

  it('merges a server row with the live upload of this tab: progress, not "interrupted"', async () => {
    const user = userEvent.setup();
    const { rerenderRows } = view();
    await user.click(screen.getByRole('button', { name: 'Adicionar Arquivo' }));
    await choose(pdf());
    for (let step = 0; step < 3; step++) {
      await user.click(within(dialog()).getByRole('button', { name: 'Próximo' }));
    }
    await user.click(within(dialog()).getByRole('button', { name: 'Enviar' }));
    uploads[0]!.created(UPLOAD);
    uploads[0]!.progress(4500);
    rerenderRows([interrupted()]);

    const tray = screen.getByRole('region', { name: 'Arquivos em andamento' });
    expect(within(tray).getAllByRole('listitem')).toHaveLength(1);
    expect(within(tray).queryByText(/Envio interrompido/)).toBeNull();
    expect((within(tray).getByRole('progressbar') as HTMLProgressElement).value).toBe(4500);
    expect(within(tray).getByRole('link', { name: 'Livro do Jogador.pdf' }).getAttribute('href')).toBe(`/files/${ID}`);
  });

  it('a server row uploading with no live upload here reads "Envio interrompido", with its expiry, and Retomar asks for the same file', async () => {
    const user = userEvent.setup();
    view({ rows: [interrupted(), { id: 'other', name: 'Bestiário.pdf', state: 'needs_review' }] });
    const tray = screen.getByRole('region', { name: 'Arquivos em andamento' });
    const rows = within(tray).getAllByRole('listitem');
    expect(rows[0]!.textContent).toContain('Envio interrompido.');
    expect(rows[0]!.textContent).toMatch(/Dá para retomar até .*\d{2}:\d{2}/);
    expect((within(rows[0]!).getByRole('progressbar') as HTMLProgressElement).value).toBe(2000);
    expect(rows[1]!.textContent).toContain('precisa de revisão');
    expect(rows[1]!.querySelector('[data-state="needs_review"]')).not.toBeNull();

    // Another file (a different name or size) is refused in the row, and nothing is created.
    const input = screen.getByTestId(`resume-${UPLOAD}`);
    fireEvent.change(input, { target: { files: [pdf('Outro.pdf')] } });
    expect(within(rows[0]!).getByRole('alert').textContent).toContain('Este não é o mesmo arquivo. Escolha Livro do Jogador.pdf, de 6 KB.');
    fireEvent.change(input, { target: { files: [pdf('Livro do Jogador.pdf', 5999)] } });
    expect(uploads).toHaveLength(0);

    // The same file resumes the known upload.
    await user.click(within(rows[0]!).getByRole('button', { name: 'Retomar Livro do Jogador.pdf' }));
    fireEvent.change(input, { target: { files: [pdf()] } });
    await act(async () => undefined);
    expect(uploads).toHaveLength(1);
    expect(uploads[0]!.options.resumeUrl).toBe(`/api/v1/uploads/${UPLOAD}`);
    expect(uploads[0]!.options.metadata).toEqual({});
    expect(within(tray).queryByText(/Envio interrompido/)).toBeNull();
    // A resume that fails stays on its row, which offers Retomar again with the reason.
    await act(async () => uploads[0]!.fail(null, null));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(within(tray).getAllByRole('listitem')).toHaveLength(2);
    expect(within(tray).getAllByRole('listitem')[0]!.textContent).toContain('Envio interrompido.');
    expect(within(tray).getAllByRole('listitem')[0]!.textContent).toContain('Algo deu errado no servidor');
  });

  it('past its expiry, or a stored entry older than 6 hours with no server row, the unfinished upload is gone; Dispensar clears it', async () => {
    const user = userEvent.setup();
    const storage = memoryStorage([
      {
        urlStorageKey: 'tus::old::1',
        uploadUrl: 'http://localhost/api/v1/uploads/0190a0b0-0000-7000-8000-0000000000aa',
        size: 10,
        metadata: { filename: 'Antigo.pdf' },
        parallelUploadUrls: null,
        creationTime: new Date(Date.now() - UPLOAD_LIFETIME_MS - 60_000).toString(),
      },
      {
        urlStorageKey: 'tus::young::2',
        uploadUrl: 'http://localhost/api/v1/uploads/0190a0b0-0000-7000-8000-0000000000bb',
        size: 10,
        metadata: { filename: 'Recente.pdf' },
        parallelUploadUrls: null,
        creationTime: new Date().toString(),
      },
    ]);
    view({ rows: [interrupted(new Date(Date.now() - 60_000).toISOString())], storage });
    const gone = ptBR.upload.tray.gone;
    await vi.waitFor(() => expect(screen.getAllByText(gone)).toHaveLength(2));
    const tray = screen.getByRole('region', { name: 'Arquivos em andamento' });
    expect(tray.textContent).toContain('Antigo.pdf');
    expect(tray.textContent).not.toContain('Recente.pdf');
    expect(tray.textContent).not.toContain('Retomar');

    await user.click(within(tray).getByRole('button', { name: 'Dispensar Antigo.pdf' }));
    expect(storage.removed).toEqual(['tus::old::1']);
    await user.click(within(tray).getByRole('button', { name: 'Dispensar Livro do Jogador.pdf' }));
    expect(screen.queryByRole('region', { name: 'Arquivos em andamento' })).toBeNull();
  });

  it('refreshes every 5 s only while a row moves and the tab is visible', async () => {
    vi.useFakeTimers();
    const { rerenderRows } = view({ rows: [{ id: ID, name: 'Livro.pdf', state: 'processing' }] });
    act(() => vi.advanceTimersByTime(REFRESH_MS));
    expect(refresh).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(REFRESH_MS));
    expect(refresh).toHaveBeenCalledTimes(2);

    // Hidden: no refresh.
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    act(() => vi.advanceTimersByTime(3 * REFRESH_MS));
    expect(refresh).toHaveBeenCalledTimes(2);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    act(() => vi.advanceTimersByTime(REFRESH_MS));
    expect(refresh).toHaveBeenCalledTimes(3);

    // Nothing moving (needs review, failed): no refresh.
    rerenderRows([
      { id: ID, name: 'Livro.pdf', state: 'needs_review' },
      { id: 'x', name: 'Outro.pdf', state: 'failed' },
    ]);
    act(() => vi.advanceTimersByTime(3 * REFRESH_MS));
    expect(refresh).toHaveBeenCalledTimes(3);
    rerenderRows([{ id: ID, name: 'Livro.pdf', state: 'waiting' }]);
    act(() => vi.advanceTimersByTime(REFRESH_MS));
    expect(refresh).toHaveBeenCalledTimes(4);
  });

  it('a processing material shows its pages done of the total in the pill and the line (Story 1.15)', () => {
    for (const [language, words] of [['pt-BR', 'processando · 0 de 320 páginas'], ['en', 'processing · 0 of 320 pages']] as const) {
      view({
        language,
        rows: [
          { id: ID, name: 'Livro.pdf', state: 'processing', pages: pagesOf(0, 320) },
          { id: 'w', name: 'Espera.pdf', state: 'processing' },
        ],
      });
      const tray = screen.getByRole('region', { name: language === 'en' ? en.upload.tray.label : ptBR.upload.tray.label });
      const [paged, unknown] = within(tray).getAllByRole('listitem');
      expect(paged!.querySelector('[data-state="processing"]')!.textContent).toBe(words);
      const line = paged!.querySelector('progress')!;
      expect([line.getAttribute('value'), line.getAttribute('max')]).toEqual(['0', '320']);
      // Without a page total yet, the pill is the word alone.
      expect(unknown!.querySelector('[data-state="processing"]')!.textContent).toBe(language === 'en' ? 'processing' : 'processando');
      cleanup();
    }
    // Pages show only while processing: a failed or a reviewed material keeps a full line.
    view({
      rows: [
        { id: ID, name: 'Livro.pdf', state: 'failed', pages: pagesOf(0, 320) },
        { id: 'r', name: 'Revisar.pdf', state: 'needs_review', pages: pagesOf(0, 320) },
      ],
    });
    const tray = screen.getByRole('region', { name: 'Arquivos em andamento' });
    expect(tray.querySelector('[data-state="failed"]')!.textContent).toBe('falhou');
    expect(tray.querySelector('[data-state="needs_review"]')!.textContent).toBe('precisa de revisão');
    for (const line of tray.querySelectorAll('progress')) {
      expect([line.getAttribute('value'), line.getAttribute('max')]).toEqual(['1', '1']);
      expect(line.getAttribute('data-phase')).toBeNull();
    }
  });

  it('a processing material names what is being read, text first, then OCR, on a dashed line (Story 1.17)', () => {
    const reading = { text: { done: 40, total: 364 }, image: { done: 0, total: 80 }, readDirectly: 40 };
    const ocr = { text: { done: 364, total: 364 }, image: { done: 12, total: 80 }, readDirectly: 364, readByOcr: 12 };
    const last = { text: { done: 364, total: 364 }, image: { done: 80, total: 80 }, readDirectly: 364, readByOcr: 79, unreadable: 1 };
    const between = { text: { done: 8, total: 18 }, image: { done: 0, total: 12 }, readDirectly: 8 };
    const cases = [
      ['pt-BR', pagesOf(40, 444, reading), 'lendo texto · 40 de 364 páginas', ['40', '364']],
      ['en', pagesOf(40, 444, reading), 'reading text · 40 of 364 pages', ['40', '364']],
      ['pt-BR', pagesOf(376, 444, ocr), 'lendo por OCR · 12 de 80 páginas', ['12', '80']],
      ['en', pagesOf(376, 444, ocr), 'reading by OCR · 12 of 80 pages', ['12', '80']],
      // Every page sorted and read, the chain not yet ended: the plain word and every page.
      ['pt-BR', pagesOf(444, 444, last), 'processando · 444 de 444 páginas', ['444', '444']],
      // OCR between text batches: the step in progress reads image pages while later text pages wait.
      ['pt-BR', pagesOf(8, 30, { ...between, reading: 'image' }), 'lendo por OCR · 0 de 12 páginas', ['0', '12']],
      ['en', pagesOf(8, 30, { ...between, reading: 'image' }), 'reading by OCR · 0 of 12 pages', ['0', '12']],
      // Without a step in progress, the same counts fall back to text first.
      ['pt-BR', pagesOf(8, 30, between), 'lendo texto · 8 de 18 páginas', ['8', '18']],
      ['pt-BR', pagesOf(8, 30, { ...between, reading: 'text' }), 'lendo texto · 8 de 18 páginas', ['8', '18']],
    ] as const;
    for (const [language, pages, words, measure] of cases) {
      view({ language, rows: [{ id: ID, name: 'Livro.pdf', state: 'processing', pages }] });
      const tray = screen.getByRole('region', { name: language === 'en' ? en.upload.tray.label : ptBR.upload.tray.label });
      expect(tray.querySelector('[data-state="processing"]')!.textContent).toBe(words);
      const line = tray.querySelector('progress')!;
      expect([line.getAttribute('value'), line.getAttribute('max')]).toEqual(measure);
      expect(line.getAttribute('data-phase')).toBe('processing');
      cleanup();
    }
    expect(trayRows([{ id: ID, name: 'Livro.pdf', state: 'processing', pages: pagesOf(40, 444, reading) }], [], [], new Set(), null)).toEqual([
      { kind: 'material', key: ID, materialId: ID, name: 'Livro.pdf', state: 'processing', sent: 40, total: 364, pages: pagesOf(40, 444, reading) },
    ]);
  });

  it("a material's page refreshes itself every 5 s while its state moves and the tab is visible (Story 1.15)", () => {
    vi.useFakeTimers();
    const { rerender } = render(<MaterialRefresher state="waiting" />);
    act(() => vi.advanceTimersByTime(REFRESH_MS));
    expect(refresh).toHaveBeenCalledTimes(1);
    rerender(<MaterialRefresher state="processing" />);
    act(() => vi.advanceTimersByTime(REFRESH_MS));
    expect(refresh).toHaveBeenCalledTimes(2);

    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    act(() => vi.advanceTimersByTime(3 * REFRESH_MS));
    expect(refresh).toHaveBeenCalledTimes(2);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    for (const still of ['failed', 'needs_review', 'ready'] as const) {
      rerender(<MaterialRefresher state={still} />);
      act(() => vi.advanceTimersByTime(3 * REFRESH_MS));
    }
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('every state has its word in both languages, with its colour beside it', () => {
    for (const [language, messages] of [['pt-BR', ptBR], ['en', en]] as const) {
      view({
        language,
        rows: (['waiting', 'processing', 'needs_review', 'failed'] as const).map((state) => ({ id: state, name: `${state}.pdf`, state })),
      });
      const tray = screen.getByRole('region', { name: messages.upload.tray.label });
      for (const state of ['waiting', 'processing', 'needs_review', 'failed'] as const) {
        const pill = tray.querySelector(`[data-state="${state}"]`)!;
        expect(pill.textContent).toBe(messages.material.state[state]);
        expect(pill.querySelector('[aria-hidden="true"]')).not.toBeNull();
      }
      cleanup();
    }
  });

  it('pairs a live upload with its server row by the material once verified: one row', async () => {
    const user = userEvent.setup();
    const { rerenderRows } = view();
    await user.click(screen.getByRole('button', { name: 'Adicionar Arquivo' }));
    await choose(pdf());
    for (let step = 0; step < 3; step++) {
      await user.click(within(dialog()).getByRole('button', { name: 'Próximo' }));
    }
    await user.click(within(dialog()).getByRole('button', { name: 'Enviar' }));
    uploads[0]!.created(UPLOAD);
    await act(async () => uploads[0]!.finish(ID));
    rerenderRows([{ id: ID, name: 'Livro do Jogador.pdf', state: 'waiting' }]);
    const tray = screen.getByRole('region', { name: 'Arquivos em andamento' });
    expect(within(tray).getAllByRole('listitem')).toHaveLength(1);
    expect(within(tray).getByText('aguardando')).toBeTruthy();
  });

  it('a verified live upload whose server row still says uploading is waiting, not interrupted', () => {
    const live = [{ key: 'live-1', batch: 1, name: 'Livro do Jogador.pdf', size: 6000, sent: 6000, phase: 'waiting' as const, uploadId: UPLOAD, materialId: ID, problem: null, set: null }];
    const rows = trayRows([interrupted()], live, [], new Set(), Date.now());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'live', state: 'waiting', materialId: ID });
  });

  it('every live upload of one material is that material\'s row; the newest decides its state', () => {
    const base = { batch: 0, name: 'Livro do Jogador.pdf', size: 6000, sent: 2000, uploadId: UPLOAD, materialId: null, problem: { category: 'server' }, set: null };
    const live = [
      { ...base, key: 'live-3', phase: 'failed' as const },
      { ...base, key: 'live-2', phase: 'failed' as const },
    ];
    const rows = trayRows([interrupted()], live, [], new Set(), Date.now());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'interrupted', problem: { category: 'server' } });
  });

  it('several stored entries of one gone upload are one row, and its Dispensar names the upload', () => {
    const old = Date.now() - UPLOAD_LIFETIME_MS - 60_000;
    const stored = [
      { storageKey: 'tus::a::1', uploadId: 'u-1', name: 'Antigo.pdf', createdAt: old },
      { storageKey: 'tus::b::2', uploadId: 'u-1', name: 'Antigo.pdf', createdAt: old },
    ];
    const rows = trayRows([], [], stored, new Set(), Date.now());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'gone', dismissKeys: ['tus::a::1', 'u-1'] });
    expect(trayRows([], [], stored, new Set(['u-1']), Date.now())).toEqual([]);
  });

  it('builds no row for a dismissed material, and keeps the server order after this tab\'s new uploads', () => {
    const live = [{ key: 'live-1', batch: 1, name: 'novo.pdf', size: 10, sent: 5, phase: 'uploading' as const, uploadId: null, materialId: null, problem: null, set: null }];
    const rows: Material[] = [
      { id: 'a', name: 'a.pdf', state: 'waiting' },
      { id: 'b', name: 'b.pdf', state: 'processing' },
    ];
    expect(trayRows(rows, live, [], new Set(['a']), 0).map((row) => row.name)).toEqual(['novo.pdf', 'b.pdf']);
  });
});

/** The names of the order step's rows, in their order. */
function pageNames(modal: HTMLElement): string[] {
  return within(within(modal).getByRole('list', { name: 'Páginas, na ordem' }))
    .getAllByRole('listitem')
    .map((row) => row.getAttribute('aria-label') ?? '');
}

/** Lets the provider's queue go on (a set's creation, then its next image). */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function nextSteps(modal: HTMLElement, count: number) {
  const user = userEvent.setup();
  for (let step = 0; step < count; step++) {
    await user.click(within(modal).getByRole('button', { name: 'Próximo' }));
  }
}

describe('photos as the pages of one material (Story 1.21)', () => {
  it('asks about two or more images, then orders them, and sends them as one set while other files stay apart', async () => {
    const user = userEvent.setup();
    const sets = setCalls();
    view({ sets });
    await user.click(screen.getByRole('button', { name: 'Adicionar Arquivo' }));
    await choose(jpeg('foto-1.jpg'), pdf('Regras.pdf'), png('foto-2.png'));
    const modal = dialog();
    expect(within(modal).getByText('Passo 1 de 6')).toBeTruthy();

    await user.click(within(modal).getByRole('button', { name: 'Próximo' }));
    expect(within(modal).getByText('Passo 2 de 6')).toBeTruthy();
    expect(within(modal).getByText('Como ficam as 2 fotos?')).toBeTruthy();
    const pages = within(modal).getByRole('radio', { name: /Páginas de um material/ }) as HTMLInputElement;
    expect(pages.checked).toBe(true);
    expect(within(modal).getByRole('radio', { name: /Cada imagem é um material/ }).closest('label')?.textContent).toContain('Cada foto vira um material de uma página.');

    await user.click(within(modal).getByRole('button', { name: 'Próximo' }));
    expect(within(modal).getByText('Passo 3 de 6')).toBeTruthy();
    const name = within(modal).getByRole('textbox', { name: 'Nome do material' }) as HTMLInputElement;
    expect(name.value).toBe('foto-1');
    expect(document.activeElement).toBe(name);
    expect(pageNames(modal)).toEqual(['foto-1.jpg, página 1 de 2', 'foto-2.png, página 2 de 2']);
    // A blank name stops the step.
    await user.clear(name);
    expect((within(modal).getByRole('button', { name: 'Próximo' }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(modal).getByRole('alert').textContent).toBe('Dê um nome ao material.');
    await user.type(name, 'Ficha do herói');

    await nextSteps(modal, 3);
    expect(within(modal).getByText('Passo 6 de 6')).toBeTruthy();
    await user.click(within(modal).getByRole('button', { name: 'Enviar' }));
    await settle();

    // The PDF first, as a material of its own, then the set: created once, its order confirmed.
    expect(uploads.map((upload) => upload.file.name)).toEqual(['Regras.pdf']);
    await act(async () => uploads[0]!.finish('m-pdf'));
    await settle();
    expect(sets.created).toEqual([
      {
        name: 'Ficha do herói',
        kind: 'rulebook',
        language: 'detect',
        campaign: BELONGING.campaign.id,
        images: [
          { name: 'foto-1.jpg', length: 6000 },
          { name: 'foto-2.png', length: 6000 },
        ],
      },
    ]);
    // Each image goes to the address of its own upload, one after another, never creating another.
    expect(uploads.map((upload) => [upload.file.name, upload.options.resumeUrl])).toEqual([
      ['Regras.pdf', undefined],
      ['foto-1.jpg', '/api/v1/uploads/upload-1-1'],
    ]);
    expect(uploads[1]!.options.metadata).toEqual({});
    await act(async () => uploads[1]!.finish('material-1'));
    await settle();
    expect(uploads[2]!.options.resumeUrl).toBe('/api/v1/uploads/upload-1-2');
    await act(async () => {
      uploads[2]!.finish('material-1');
    });
    await settle();
    expect(polite()).toBe('Ficha do herói: aguardando.');
  });

  it('reorders by Alt+arrows on a row and by its buttons, announcing each move politely, and sends that order', async () => {
    const user = userEvent.setup();
    const sets = setCalls();
    view({ sets });
    await user.click(screen.getByRole('button', { name: 'Adicionar Arquivo' }));
    await choose(heic('foto-1.heic'), jpeg('foto-2.jpg'), png('foto-3.png'));
    const modal = dialog();
    await nextSteps(modal, 2);
    // The row's controls are its buttons: Alt+arrows on one of them move the row, and focus stays on that button.
    const down = within(modal).getByRole('button', { name: 'Descer foto-1.heic' });
    expect(down.getAttribute('aria-describedby')).not.toBeNull();
    expect(document.getElementById(down.getAttribute('aria-describedby')!)?.textContent).toBe('Página 1');
    down.focus();
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}');
    expect(pageNames(modal)).toEqual(['foto-2.jpg, página 1 de 3', 'foto-1.heic, página 2 de 3', 'foto-3.png, página 3 de 3']);
    expect(polite()).toBe('foto-1.heic, página 2 de 3');
    expect(document.activeElement).toBe(within(modal).getByRole('button', { name: 'Descer foto-1.heic' }));
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}');
    expect(pageNames(modal)[2]).toBe('foto-1.heic, página 3 de 3');
    // At the bottom its "Descer" is disabled: focus goes to its "Subir".
    expect(document.activeElement).toBe(within(modal).getByRole('button', { name: 'Subir foto-1.heic' }));
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}');
    expect(pageNames(modal)[2]).toBe('foto-1.heic, página 3 de 3');
    // Without Alt the arrows do nothing here.
    await user.keyboard('{ArrowUp}');
    expect(pageNames(modal)[2]).toBe('foto-1.heic, página 3 de 3');
    // No row is a tab stop of its own, and no thumbnail canvas is hidden on its own (Sonar S6845, S6825).
    for (const row of within(modal).getAllByRole('listitem')) {
      expect(row.hasAttribute('tabindex')).toBe(false);
    }
    for (const canvas of modal.querySelectorAll('canvas')) {
      expect(canvas.hasAttribute('aria-hidden')).toBe(false);
      expect(canvas.closest('[aria-hidden="true"]')).not.toBeNull();
    }

    const up = within(modal).getByRole('button', { name: 'Subir foto-3.png' });
    expect((within(modal).getByRole('button', { name: 'Subir foto-2.jpg' }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(up);
    expect(pageNames(modal)).toEqual(['foto-3.png, página 1 de 3', 'foto-2.jpg, página 2 de 3', 'foto-1.heic, página 3 de 3']);
    expect(polite()).toBe('foto-3.png, página 1 de 3');
    // At the top its "Subir" is disabled: focus goes to its "Descer".
    expect(document.activeElement).toBe(within(modal).getByRole('button', { name: 'Descer foto-3.png' }));

    await nextSteps(modal, 3);
    await user.click(within(modal).getByRole('button', { name: 'Enviar' }));
    await settle();
    expect(sets.created[0]!.name).toBe('foto-3');
    expect(sets.created[0]!.images.map((image) => image.name)).toEqual(['foto-3.png', 'foto-2.jpg', 'foto-1.heic']);
  });

  it('reorders by dragging a row onto another', async () => {
    const user = userEvent.setup();
    view({ sets: setCalls() });
    await user.click(screen.getByRole('button', { name: 'Adicionar Arquivo' }));
    await choose(jpeg('a.jpg'), jpeg('b.jpg'), jpeg('c.jpg'));
    const modal = dialog();
    await nextSteps(modal, 2);
    const data = new Map<string, string>();
    const dataTransfer = { effectAllowed: '', dropEffect: '', setData: (type: string, value: string) => data.set(type, value), getData: (type: string) => data.get(type) ?? '' };
    const rows = within(within(modal).getByRole('list', { name: 'Páginas, na ordem' })).getAllByRole('listitem');
    expect(rows.every((row) => row.getAttribute('draggable') === 'true')).toBe(true);
    fireEvent.dragStart(rows[2]!, { dataTransfer });
    expect(rows[2]!.getAttribute('data-dragging')).toBe('true');
    fireEvent.dragOver(rows[0]!, { dataTransfer });
    fireEvent.drop(rows[0]!, { dataTransfer });
    expect(pageNames(modal)).toEqual(['c.jpg, página 1 de 3', 'a.jpg, página 2 de 3', 'b.jpg, página 3 de 3']);
    expect(polite()).toBe('c.jpg, página 1 de 3');
  });

  it('shows a picture of the images a browser shows, upright, and the format of a HEIC or a TIFF', async () => {
    const user = userEvent.setup();
    const drawn: unknown[] = [];
    vi.stubGlobal('createImageBitmap', async (_file: Blob, options: ImageBitmapOptions) => {
      drawn.push(options);
      return { width: 100, height: 50, close: () => undefined };
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ clearRect: () => undefined, drawImage: () => undefined } as unknown as CanvasRenderingContext2D);
    try {
      view({ sets: setCalls() });
      await user.click(screen.getByRole('button', { name: 'Adicionar Arquivo' }));
      await choose(jpeg('a.jpg'), heic('b.heic'), fileOf('c.tif', new Uint8Array([0x49, 0x49, 0x2a, 0])));
      const modal = dialog();
      await nextSteps(modal, 2);
      await settle();
      const rows = within(within(modal).getByRole('list', { name: 'Páginas, na ordem' })).getAllByRole('listitem');
      expect(rows[0]!.querySelector('canvas')).not.toBeNull();
      expect(rows[1]!.querySelector('[data-placeholder]')?.textContent).toBe('HEIC');
      expect(rows[2]!.querySelector('[data-placeholder]')?.textContent).toBe('TIFF');
      expect(drawn).toEqual([{ imageOrientation: 'from-image', resizeWidth: 96, resizeQuality: 'low' }]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('refuses a set past 500 images or 2 GB in the dialog, with the limit', async () => {
    const user = userEvent.setup();
    view({ sets: setCalls() });
    await user.click(screen.getByRole('button', { name: 'Adicionar Arquivo' }));
    const big = [jpeg('a.jpg'), jpeg('b.jpg')];
    for (const file of big) {
      Object.defineProperty(file, 'size', { value: 1.5 * 1024 ** 3 });
    }
    await choose(...big);
    const modal = dialog();
    await nextSteps(modal, 2);
    expect(within(modal).getByRole('alert').textContent).toContain('podem somar até 2 GB, e estas somam 3,2 GB');
    expect((within(modal).getByRole('button', { name: 'Próximo' }) as HTMLButtonElement).disabled).toBe(true);
    // As separate materials each one is within its own limit.
    await user.click(within(modal).getByRole('button', { name: 'Voltar' }));
    await user.click(within(modal).getByRole('radio', { name: /Cada imagem é um material/ }));
    expect(within(modal).getByText('Passo 2 de 5')).toBeTruthy();

    cleanup();
    view({ sets: setCalls() });
    await user.click(screen.getByRole('button', { name: 'Adicionar Arquivo' }));
    await choose(...Array.from({ length: 501 }, (_unused, index) => jpeg(`f${index}.jpg`, 100)));
    await nextSteps(dialog(), 2);
    expect(within(dialog()).getByRole('alert').textContent).toContain('até 500 fotos, e estas são 501');
    expect((within(dialog()).getByRole('button', { name: 'Próximo' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('sends each image as a material of its own when asked, and a lone image as a set of one with no question', async () => {
    const user = userEvent.setup();
    const sets = setCalls();
    view({ sets });
    await user.click(screen.getByRole('button', { name: 'Adicionar Arquivo' }));
    await choose(jpeg('frente.jpg'), png('verso.png'));
    const modal = dialog();
    await user.click(within(modal).getByRole('button', { name: 'Próximo' }));
    await user.click(within(modal).getByRole('radio', { name: /Cada imagem é um material/ }));
    await nextSteps(modal, 3);
    expect(within(modal).getByText('Passo 5 de 5')).toBeTruthy();
    await user.click(within(modal).getByRole('button', { name: 'Enviar' }));
    await settle();
    await act(async () => uploads[0]!.finish('material-1'));
    await settle();
    expect(sets.created.map((set) => [set.name, set.images.map((image) => image.name)])).toEqual([
      ['frente.jpg', ['frente.jpg']],
      ['verso.png', ['verso.png']],
    ]);

    cleanup();
    const alone = setCalls();
    view({ sets: alone });
    await user.click(screen.getByRole('button', { name: 'Adicionar Arquivo' }));
    await choose(png('mapa.png'));
    expect(within(dialog()).getByText('Passo 1 de 4')).toBeTruthy();
    await nextSteps(dialog(), 3);
    await user.click(within(dialog()).getByRole('button', { name: 'Enviar' }));
    await settle();
    expect(alone.created.map((set) => set.name)).toEqual(['mapa.png']);
    expect(uploads.at(-1)!.options.resumeUrl).toBe('/api/v1/uploads/upload-1-1');
  });

  it('a refused set says so at once and sends none of its images', async () => {
    const user = userEvent.setup();
    const sets = setCalls();
    sets.next.create = { ok: false, problem: { status: 413, category: 'upload', code: 'upload.set_too_large', params: { maxImages: 500 } } };
    view({ sets });
    await user.click(screen.getByRole('button', { name: 'Adicionar Arquivo' }));
    await choose(jpeg('a.jpg'), jpeg('b.jpg'));
    await nextSteps(dialog(), 5);
    await user.click(within(dialog()).getByRole('button', { name: 'Enviar' }));
    await settle();
    expect(uploads).toHaveLength(0);
    expect(urgent()).toBe('a: falhou. Um material pode ter até 500 fotos, somando até 2 GB.');
    const tray = screen.getByRole('region', { name: 'Arquivos em andamento' });
    expect(within(tray).getAllByRole('listitem')).toHaveLength(1);
    expect(within(tray).getByText('falhou')).toBeTruthy();
  });
});

describe('a set in the tray (Story 1.21)', () => {
  const MATERIAL = '0190a0b0-0000-7000-8000-000000000003';
  const SET = '0190a0b0-0000-7000-8000-000000000004';
  const image = (position: number, state: 'open' | 'complete' | 'failed', extra: Record<string, unknown> = {}) => ({
    position,
    uploadId: `0190a0b0-0000-7000-8000-00000000001${position}`,
    ...(state === 'complete' ? {} : { name: `foto-${position}.jpg` }),
    state,
    offset: state === 'complete' ? 6000 : 0,
    length: 6000,
    expiresAt: '2099-01-01T00:00:00Z',
    ...extra,
  });
  const setMaterial = (images: ReturnType<typeof image>[]): Material => ({
    id: MATERIAL,
    name: 'Ficha',
    state: 'uploading',
    imageSet: { id: SET, images: images as NonNullable<Material['imageSet']>['images'] },
  });

  it('names a failed image with its reason, replaces it at its place with an image, or goes on without it', async () => {
    const user = userEvent.setup();
    const sets = setCalls();
    view({ sets, rows: [setMaterial([image(1, 'complete'), image(2, 'failed', { failure: 'upload.file_checksum_mismatch' }), image(3, 'complete')])] });
    const tray = screen.getByRole('region', { name: 'Arquivos em andamento' });
    expect(within(tray).getAllByRole('listitem')).toHaveLength(1);
    expect(within(tray).getByRole('link', { name: 'Ficha' }).getAttribute('href')).toBe(`/files/${MATERIAL}`);
    expect(tray.textContent).toContain('A foto 2 (foto-2.jpg) não entrou: O arquivo que chegou é diferente do que você escolheu e foi descartado. Envie-o de novo.');
    expect((within(tray).getByRole('progressbar') as HTMLProgressElement).value).toBe(12000);

    // "Substituir" takes only an image: anything else is refused in the row, and nothing is asked of the server.
    const input = screen.getByTestId(`replace-${image(2, 'failed').uploadId}`);
    fireEvent.change(input, { target: { files: [pdf('errado.pdf')] } });
    await settle();
    expect(within(tray).getByRole('alert').textContent).toBe('errado.pdf não é uma imagem que o GMshield aceite. Escolha um JPG, PNG, WebP, TIFF, BMP ou HEIC.');
    expect(sets.replaced).toEqual([]);
    expect(within(tray).getByRole('button', { name: 'Substituir a foto 2, foto-2.jpg' })).toBeTruthy();
    fireEvent.change(input, { target: { files: [jpeg('nova.jpg')] } });
    await settle();
    await settle();
    expect(sets.replaced).toEqual([[SET, 2, { name: 'nova.jpg', length: 6000 }]]);
    expect(uploads.map((upload) => [upload.file.name, upload.options.resumeUrl])).toEqual([['nova.jpg', '/api/v1/uploads/upload-again-2']]);

    await user.click(within(tray).getByRole('button', { name: 'Continuar sem a foto 2, foto-2.jpg' }));
    await settle();
    expect(sets.dropped).toEqual([[SET, 2]]);
    expect(polite()).toBe('Ficha: aguardando.');
    expect(refresh).toHaveBeenCalled();
  });

  it('an image refused at its first bytes shows that reason; images still missing can be resumed by their files', async () => {
    view({ sets: setCalls(), rows: [setMaterial([image(1, 'failed', { failure: 'upload.format_refused' }), image(2, 'open'), image(3, 'complete')])] });
    const tray = screen.getByRole('region', { name: 'Arquivos em andamento' });
    expect(tray.textContent).toContain('A foto 1 (foto-1.jpg) não entrou: Este formato não é aceito.');
    expect(tray.textContent).toContain('Envio interrompido: faltam 1 de 3 fotos.');
    const resume = screen.getByTestId(`resume-set-${SET}`);
    fireEvent.change(resume, { target: { files: [jpeg('outra.jpg')] } });
    expect(within(tray).getByRole('alert').textContent).toBe('Estas não são as fotos que faltam. Escolha foto-2.jpg.');
    expect(uploads).toHaveLength(0);
    fireEvent.change(resume, { target: { files: [jpeg('foto-2.jpg')] } });
    await settle();
    expect(uploads.map((upload) => upload.options.resumeUrl)).toEqual([`/api/v1/uploads/${image(2, 'open').uploadId}`]);
    uploads[0]!.progress(3000);
    expect(tray.querySelector('[data-state="uploading"]')!.textContent).toBe('enviando · 50%');
    expect(tray.textContent).not.toContain('Envio interrompido');
  });

  it('a refused replacement is shown in the row of the image it was for', async () => {
    const sets = setCalls();
    sets.next.replace = { ok: false, problem: { status: 413, category: 'upload', code: 'upload.set_too_large', params: {} } };
    view({ sets, rows: [setMaterial([image(1, 'complete'), image(2, 'failed', { failure: 'upload.format_refused' })])] });
    const tray = screen.getByRole('region', { name: 'Arquivos em andamento' });
    fireEvent.change(screen.getByTestId(`replace-${image(2, 'failed').uploadId}`), { target: { files: [jpeg('nova.jpg')] } });
    await settle();
    await settle();
    expect(sets.replaced).toHaveLength(1);
    expect(uploads).toHaveLength(0);
    expect(within(tray).getByRole('alert').textContent).toBe('Um material pode ter até 500 fotos, somando até 2 GB.');
  });

  it('an image this tab failed to send on a network or server error stays missing, with Retomar and the reason', async () => {
    view({ sets: setCalls(), rows: [setMaterial([image(1, 'complete'), image(2, 'open')])] });
    fireEvent.change(screen.getByTestId(`resume-set-${SET}`), { target: { files: [jpeg('foto-2.jpg')] } });
    await settle();
    await act(async () => uploads[0]!.fail(503, { status: 503, category: 'server', code: 'server.unavailable' }));
    await settle();
    const tray = screen.getByRole('region', { name: 'Arquivos em andamento' });
    expect(within(tray).queryByRole('button', { name: /Substituir/ })).toBeNull();
    expect(within(tray).queryByRole('button', { name: /Continuar sem/ })).toBeNull();
    expect(within(tray).getByRole('button', { name: 'Retomar as fotos de Ficha' })).toBeTruthy();
    expect(tray.textContent).toContain('Envio interrompido: faltam 1 de 2 fotos.');
    expect(tray.textContent).toContain('A foto 2 (foto-2.jpg) não entrou:');
    // A refusal the backend records (a whole-file mismatch) is a failed image, with its two actions.
    fireEvent.change(screen.getByTestId(`resume-set-${SET}`), { target: { files: [jpeg('foto-2.jpg')] } });
    await settle();
    await act(async () => uploads[1]!.fail(422, { status: 422, category: 'upload', code: 'upload.file_checksum_mismatch' }));
    await settle();
    expect(urgent()).toBe('foto-2.jpg: falhou. O arquivo que chegou é diferente do que você escolheu e foi descartado. Envie-o de novo.');
    expect(within(tray).getByRole('button', { name: 'Substituir a foto 2, foto-2.jpg' })).toBeTruthy();
    expect(within(tray).queryByRole('button', { name: /Retomar as fotos/ })).toBeNull();
  });

  it('one chosen file fills one missing place only, and the picker offers images', async () => {
    const same = { name: 'igual.jpg' };
    view({ sets: setCalls(), rows: [setMaterial([image(1, 'open', same), image(2, 'open', same)])] });
    const input = screen.getByTestId(`resume-set-${SET}`) as HTMLInputElement;
    expect(input.accept).toContain('.heic');
    fireEvent.change(input, { target: { files: [jpeg('igual.jpg')] } });
    await settle();
    expect(uploads.map((upload) => upload.options.resumeUrl)).toEqual([`/api/v1/uploads/${image(1, 'open').uploadId}`]);
  });

  it('going on without the last image says the set failed; without another, that it still sends', async () => {
    const user = userEvent.setup();
    const sets = setCalls();
    sets.next.drop = { ok: true, data: { state: 'discarded' } };
    view({ sets, rows: [setMaterial([image(1, 'failed', { failure: 'upload.expired' })])] });
    await user.click(screen.getByRole('button', { name: 'Continuar sem a foto 1, foto-1.jpg' }));
    await settle();
    expect(polite()).toBe('Ficha: falhou.');
    cleanup();
    const other = setCalls();
    other.next.drop = { ok: true, data: { state: 'uploading' } };
    view({ sets: other, rows: [setMaterial([image(1, 'failed', { failure: 'upload.expired' }), image(2, 'open')])] });
    await user.click(screen.getByRole('button', { name: 'Continuar sem a foto 1, foto-1.jpg' }));
    await settle();
    expect(polite()).toBe('Ficha: enviando.');
  });

  it("a set's images sent before the server's rows show it are one row of their bytes in all", () => {
    const set = { key: 'set-1', name: 'Ficha', id: SET, position: 1 };
    const base = { batch: 1, size: 1000, uploadId: null, materialId: MATERIAL, problem: null };
    const live = [
      { ...base, key: 'live-2', name: 'b.jpg', sent: 0, phase: 'queued' as const, set: { ...set, position: 2 } },
      { ...base, key: 'live-1', name: 'a.jpg', sent: 500, phase: 'uploading' as const, set },
    ];
    const rows = trayRows([], live, [], new Set(), Date.now());
    expect(rows).toEqual([{ kind: 'live', key: 'set-1', materialId: MATERIAL, name: 'Ficha', state: 'uploading', sent: 500, total: 2000, problem: null }]);
  });
});

describe("the conversation's empty state (Story 2.4)", () => {
  it('opens the guided upload, the same dialog as the sidebar', async () => {
    const user = userEvent.setup();
    render(
      <UploadsProvider texts={uploadTexts('pt-BR')} belonging={BELONGING} urlStorage={memoryStorage()}>
        <Sidebar labels={LABELS} campaign="Primeira campanha" initialState="open" menu={<p>menu</p>} trayRows={[]} />
        <Conversation language="pt-BR" campaignId={BELONGING.campaign.id} hasSources={false} review={null} />
      </UploadsProvider>,
    );
    expect(screen.queryByRole('dialog', { name: 'Adicionar arquivos' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Enviar um arquivo' }));

    const modal = screen.getByRole('dialog', { name: 'Adicionar arquivos' });
    expect((modal as HTMLDialogElement).open).toBe(true);
    expect(within(modal).getByText('Passo 1 de 4')).toBeTruthy();
  });
});

describe('the announcements (Story 1.14)', () => {
  it('says each state change and every 10 % politely, and a refusal at once', async () => {
    const user = userEvent.setup();
    view();
    await user.click(screen.getByRole('button', { name: 'Adicionar Arquivo' }));
    await choose(pdf('Livro.pdf', 10_000));
    for (let step = 0; step < 3; step++) {
      await user.click(within(dialog()).getByRole('button', { name: 'Próximo' }));
    }
    await user.click(within(dialog()).getByRole('button', { name: 'Enviar' }));
    expect(polite()).toBe('Livro.pdf: enviando.');
    const heard: string[] = [];
    for (const sent of [500, 1000, 1500, 2600, 9999]) {
      uploads[0]!.progress(sent);
      heard.push(polite());
    }
    expect(heard).toEqual(['Livro.pdf: enviando.', 'Livro.pdf: 10% enviado.', 'Livro.pdf: 10% enviado.', 'Livro.pdf: 20% enviado.', 'Livro.pdf: 90% enviado.']);
    await act(async () => uploads[0]!.finish('m'));
    expect(polite()).toBe('Livro.pdf: aguardando.');
    expect(screen.getByTestId('uploads-polite').getAttribute('aria-live')).toBe('polite');
    expect(screen.getByTestId('uploads-urgent').getAttribute('aria-live')).toBe('assertive');

    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Adicionar Arquivo' }));
    await choose(fileOf('x.zip', new Uint8Array([0x50, 0x4b, 3, 4])));
    expect(urgent()).toContain('x.zip está num formato que o GMshield não aceita');
  });
});

describe('the upload id of an address (Story 1.14)', () => {
  it('is the last non-empty segment, with or without trailing slashes', async () => {
    const { uploadIdOf } = await import('@/components/uploads/types');
    expect(uploadIdOf('http://localhost/api/v1/uploads/0190a0b0-0000-7000-8000-000000000005')).toBe('0190a0b0-0000-7000-8000-000000000005');
    expect(uploadIdOf('/api/v1/uploads/abc//')).toBe('abc');
    expect(uploadIdOf('')).toBe('');
    expect(uploadIdOf('/'.repeat(50_000))).toBe('');
  });
});
