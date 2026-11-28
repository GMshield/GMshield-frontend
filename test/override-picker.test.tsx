import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ refresh: () => undefined, push: () => undefined, replace: () => undefined }),
}));

const { ArtifactOverride } = await import('@/components/artifacts/ArtifactOverride');
const { artifactOverrideTexts } = await import('@/app/(signed-in)/campaigns/[id]/artifacts/texts');
const { translator } = await import('@/messages');

type Page = Awaited<ReturnType<import('@/components/artifacts/OverridePicker').LoadOverrideTargets>>;
type State = import('@/components/artifacts/ArtifactOverride').OverrideActionState;

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

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const CAMPAIGN = '0190a0b0-0000-7000-8000-000000000002';
const ARTIFACT = '0190a0b0-0000-7000-8000-000000000900';
const TYPES = [
  { key: 'spell', label: 'Magia' },
  { key: 'item', label: 'Item' },
];
const SPELLS = ['Bola de Fogo', 'Relâmpago', 'Luz'].map((name, index) => ({
  id: `0190a0b0-0000-7000-8000-00000000070${index}`,
  name,
  materialName: 'Livro do Jogador',
}));

/** A loader that answers two pages of spells (two a page), one item, and records what it was asked. */
function loader() {
  const asked: { recordType: string; query: string; page: number }[] = [];
  const load = vi.fn(async (_campaign: string, recordType: string, query: string, page: number): Promise<Page> => {
    asked.push({ recordType, query, page });
    if (recordType === 'item') {
      return { ok: true, rows: [], paging: { page: 1, pages: 1, total: 0, from: 0, to: 0 } };
    }
    const rows = SPELLS.filter((spell) => spell.name.toLowerCase().includes(query.toLowerCase()));
    const shown = rows.slice((page - 1) * 2, page * 2);
    return { ok: true, rows: shown, paging: { page, pages: Math.max(1, Math.ceil(rows.length / 2)), total: rows.length, from: (page - 1) * 2 + 1, to: (page - 1) * 2 + shown.length } };
  });
  return { asked, load };
}

function actions(set: State = { serial: 1, done: true, error: null }) {
  const posted: Record<string, string>[] = [];
  const setAction = vi.fn(async (_previous: State, form: FormData) => {
    posted.push(Object.fromEntries([...form.entries()].map(([key, value]) => [key, String(value)])));
    return set;
  });
  const removeAction = vi.fn(async (_previous: State, form: FormData) => {
    posted.push(Object.fromEntries([...form.entries()].map(([key, value]) => [key, String(value)])));
    return { serial: 1, done: true, error: null };
  });
  return { posted, setAction, removeAction };
}

function renderSection(
  options: { language?: 'pt-BR' | 'en'; set?: State; override?: Parameters<typeof ArtifactOverride>[0]['override']; load?: ReturnType<typeof loader>['load'] } = {},
) {
  const language = options.language ?? 'pt-BR';
  const { asked, load: loaded } = loader();
  const load = options.load ?? loaded;
  const { posted, setAction, removeAction } = actions(options.set);
  const view = render(
    <ArtifactOverride
      campaignId={CAMPAIGN}
      artifactId={ARTIFACT}
      override={options.override ?? null}
      types={TYPES}
      recordType="spell"
      texts={artifactOverrideTexts(translator(language))}
      language={language}
      setAction={setAction}
      removeAction={removeAction}
      load={load}
    />,
  );
  return { ...view, asked, posted, load };
}

describe('the override picker (Story 5.5 part A)', () => {
  it('by keyboard: it opens on the name filter, Tab reaches the type, every row and the pager, and Esc gives focus back', async () => {
    const user = userEvent.setup();
    const { asked } = renderSection();
    const opener = screen.getByRole('button', { name: 'Substituir um registro' });
    await user.tab();
    expect(document.activeElement).toBe(opener);
    await user.keyboard('{Enter}');
    const dialog = screen.getByRole('dialog', { name: 'Substituir um registro' });
    expect(document.activeElement).toBe(within(dialog).getByRole('searchbox', { name: 'Filtrar por nome' }));
    await vi.waitFor(() => expect(within(dialog).getAllByRole('radio')).toHaveLength(2));
    expect(asked[0]).toEqual({ recordType: 'spell', query: '', page: 1 });
    expect((within(dialog).getByRole('combobox', { name: 'Tipo de registro' }) as HTMLSelectElement).value).toBe('spell');

    const order: string[] = [];
    for (let step = 0; step < 7; step += 1) {
      await user.tab();
      const active = document.activeElement as HTMLElement;
      expect(dialog.contains(active)).toBe(true);
      order.push(active.getAttribute('aria-label') ?? (active.closest('label')?.textContent || active.textContent) ?? '');
    }
    expect(order).toEqual([
      'Bola de FogoLivro do Jogador',
      'RelâmpagoLivro do Jogador',
      'Anterior',
      'Próxima',
      'Cancelar',
      'Substituir',
      'Tipo de registro',
    ].map((text, index) => (index === 2 || index === 3 || index === 6 ? expect.stringContaining(text) : text)));
    await user.keyboard('{Escape}');
    expect(dialog.hasAttribute('open')).toBe(false);
    expect(document.activeElement).toBe(opener);
  });

  it('filters by name, pages with its own buttons, changes type, and "Substituir" posts the record picked', async () => {
    const user = userEvent.setup();
    const { asked, posted, container } = renderSection();
    await user.click(screen.getByRole('button', { name: 'Substituir um registro' }));
    const dialog = screen.getByRole('dialog');
    await vi.waitFor(() => expect(within(dialog).getAllByRole('radio')).toHaveLength(2));
    // With nothing picked, it says to pick one and posts nothing.
    await user.click(within(dialog).getByRole('button', { name: 'Substituir' }));
    expect(within(dialog).getByRole('alert').textContent).toBe('Escolha um registro da lista.');
    expect(posted).toEqual([]);

    await user.click(within(dialog).getByRole('button', { name: /Próxima/ }));
    await vi.waitFor(() => expect(within(dialog).getAllByRole('radio').map((radio) => radio.closest('label')?.textContent)).toEqual(['LuzLivro do Jogador']));
    expect(asked.at(-1)).toEqual({ recordType: 'spell', query: '', page: 2 });

    await user.type(within(dialog).getByRole('searchbox'), 'relâ');
    await vi.waitFor(() => expect(asked.at(-1)).toEqual({ recordType: 'spell', query: 'relâ', page: 1 }));
    await vi.waitFor(() => expect(within(dialog).getAllByRole('radio')).toHaveLength(1));
    await user.click(within(dialog).getByRole('radio'));
    expect((within(dialog).getByRole('radio') as HTMLInputElement).checked).toBe(true);
    await user.click(within(dialog).getByRole('button', { name: 'Substituir' }));
    await vi.waitFor(() => expect(posted).toEqual([{ campaignId: CAMPAIGN, artifactId: ARTIFACT, recordId: SPELLS[1]!.id }]));
    // Stored: the picker closes.
    await vi.waitFor(() => expect(dialog.hasAttribute('open')).toBe(false));
    expect(container.querySelectorAll('[style]')).toHaveLength(0);
  });

  it('a type with no record, or a filter that matches none, says so; a refusal of "Substituir" shows in the picker', async () => {
    const user = userEvent.setup();
    renderSection({ set: { serial: 1, done: false, error: 'Outro artefato desta campanha já substitui esse registro.' } });
    await user.click(screen.getByRole('button', { name: 'Substituir um registro' }));
    const dialog = screen.getByRole('dialog');
    await vi.waitFor(() => expect(within(dialog).getAllByRole('radio')).toHaveLength(2));
    await user.click(within(dialog).getAllByRole('radio')[0]!);
    await user.click(within(dialog).getByRole('button', { name: 'Substituir' }));
    await vi.waitFor(() => expect(within(dialog).getByRole('alert').textContent).toBe('Outro artefato desta campanha já substitui esse registro.'));
    expect(dialog.hasAttribute('open')).toBe(true);

    await user.type(within(dialog).getByRole('searchbox'), 'zzz{Enter}');
    await vi.waitFor(() => expect(within(dialog).getByRole('status').textContent).toBe('Nenhum registro com esse nome.'));
    await user.selectOptions(within(dialog).getByRole('combobox'), 'item');
    await user.clear(within(dialog).getByRole('searchbox'));
    await user.keyboard('{Enter}');
    await vi.waitFor(() => expect(within(dialog).getByRole('status').textContent).toBe('Nenhum registro deste tipo no sistema desta campanha.'));
  });

  it('a mark names its record with "Remover substituição", which posts the artifact; it speaks English too', async () => {
    const user = userEvent.setup();
    const record = SPELLS[0]!;
    const { posted } = renderSection({ language: 'en', override: { recordId: record.id, name: record.name, typeLabel: 'Spell', removed: false } });
    expect(screen.getByText('In this campaign, it overrides:')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Bola de Fogo' }).getAttribute('href')).toBe(`/campaigns/${CAMPAIGN}/records/${record.id}?artifact=${ARTIFACT}`);
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Remove override' }));
    });
    await vi.waitFor(() => expect(posted).toEqual([{ campaignId: CAMPAIGN, artifactId: ARTIFACT }]));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('the override picker, its pick and its failures (Story 5.5 part A)', () => {
  it('a pick goes when the page or the filter changes, so "Substituir" never posts a record no longer shown', async () => {
    const user = userEvent.setup();
    const { posted } = renderSection();
    await user.click(screen.getByRole('button', { name: 'Substituir um registro' }));
    const dialog = screen.getByRole('dialog');
    await vi.waitFor(() => expect(within(dialog).getAllByRole('radio')).toHaveLength(2));
    await user.click(within(dialog).getAllByRole('radio')[0]!);

    await user.click(within(dialog).getByRole('button', { name: /Próxima/ }));
    await vi.waitFor(() => expect(within(dialog).getAllByRole('radio')).toHaveLength(1));
    await user.click(within(dialog).getByRole('button', { name: /Anterior/ }));
    await vi.waitFor(() => expect(within(dialog).getAllByRole('radio')).toHaveLength(2));
    expect(within(dialog).getAllByRole('radio').map((radio) => (radio as HTMLInputElement).checked)).toEqual([false, false]);
    await user.click(within(dialog).getByRole('button', { name: 'Substituir' }));
    expect(within(dialog).getByRole('alert').textContent).toBe('Escolha um registro da lista.');

    await user.click(within(dialog).getAllByRole('radio')[0]!);
    await user.type(within(dialog).getByRole('searchbox'), 'bola{Enter}');
    await vi.waitFor(() => expect(within(dialog).getAllByRole('radio')).toHaveLength(1));
    expect((within(dialog).getByRole('radio') as HTMLInputElement).checked).toBe(false);
    await user.click(within(dialog).getByRole('button', { name: 'Substituir' }));
    expect(within(dialog).getByRole('alert').textContent).toBe('Escolha um registro da lista.');
    expect(posted).toEqual([]);
  });

  it('a page that cannot be read says so in the alert, never "Carregando" for ever', async () => {
    const user = userEvent.setup();
    const load = vi.fn(async (): Promise<Page> => {
      throw new Error('unreachable');
    });
    renderSection({ load });
    await user.click(screen.getByRole('button', { name: 'Substituir um registro' }));
    const dialog = screen.getByRole('dialog');
    const generic = translator('pt-BR')('errors.categories.server');
    await vi.waitFor(() => expect(within(dialog).getByRole('alert').textContent).toBe(generic));
    expect(within(dialog).queryAllByRole('radio')).toEqual([]);
    expect(within(dialog).queryByRole('status')).toBeNull();
  });
});
