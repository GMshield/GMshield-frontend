import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ refresh: () => undefined, push: () => undefined, replace: () => undefined }),
}));

const { ArtifactRelations } = await import('@/components/artifacts/ArtifactRelations');
const { RecordRelated } = await import('@/components/RecordRelated');
const { artifactRelationsTexts } = await import('@/app/(signed-in)/campaigns/[id]/artifacts/texts');
const { translator } = await import('@/messages');

type Page = Awaited<ReturnType<import('@/components/artifacts/ArtifactRelations').LoadRelationTargets>>;
type State = import('@/components/artifacts/ArtifactOverride').OverrideActionState;
type Shown = import('@/components/artifacts/ArtifactRelations').ShownRelation;

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
});

const CAMPAIGN = '0190a0b0-0000-7000-8000-000000000002';
const ARTIFACT = '0190a0b0-0000-7000-8000-000000000900';
const TYPES = [
  { key: 'creature', label: 'Criatura' },
  { key: 'note', label: 'Nota' },
];
const TARGETS = [
  { id: '0190a0b0-0000-7000-8000-000000000901', name: 'Guarda', materialName: 'Artefato desta campanha', tier: 'campaign' as const },
  { id: '0190a0b0-0000-7000-8000-000000000700', name: 'Troll', materialName: 'Monstros', tier: 'system' as const },
  { id: '0190a0b0-0000-7000-8000-000000000701', name: 'Lobo', materialName: 'Outro', tier: 'other' as const },
];
const TROLL: Shown = {
  recordId: TARGETS[1]!.id,
  name: 'Troll',
  typeLabel: 'Criatura',
  tier: 'system',
  href: `/search/records/${TARGETS[1]!.id}`,
  removed: false,
};
const MAP: Shown = {
  recordId: '0190a0b0-0000-7000-8000-000000000902',
  name: 'Mapa',
  typeLabel: 'Nota',
  tier: 'campaign',
  href: `/campaigns/${CAMPAIGN}/artifacts/0190a0b0-0000-7000-8000-000000000902`,
  removed: false,
};

/** A loader that answers the targets two a page, and records what it was asked (the artifact included). */
function loader() {
  const asked: { artifactId: string; recordType: string; query: string; page: number }[] = [];
  const load = vi.fn(async (_campaign: string, artifactId: string, recordType: string, query: string, page: number): Promise<Page> => {
    asked.push({ artifactId, recordType, query, page });
    const rows = recordType === 'creature' ? TARGETS.filter((row) => row.name.toLowerCase().includes(query.toLowerCase())) : [];
    const shown = rows.slice((page - 1) * 2, page * 2);
    return {
      ok: true,
      rows: shown,
      paging: { page, pages: Math.max(1, Math.ceil(rows.length / 2)), total: rows.length, from: rows.length === 0 ? 0 : (page - 1) * 2 + 1, to: (page - 1) * 2 + shown.length },
    };
  });
  return { asked, load };
}

function renderSection(options: { language?: 'pt-BR' | 'en'; related?: readonly Shown[]; relate?: State; unrelate?: State } = {}) {
  const language = options.language ?? 'pt-BR';
  const { asked, load } = loader();
  const posted: { action: string; fields: Record<string, string> }[] = [];
  const record = (action: string, answer: State) =>
    vi.fn(async (_previous: State, form: FormData) => {
      posted.push({ action, fields: Object.fromEntries([...form.entries()].map(([key, value]) => [key, String(value)])) });
      return answer;
    });
  const view = render(
    <ArtifactRelations
      campaignId={CAMPAIGN}
      artifactId={ARTIFACT}
      related={options.related ?? []}
      types={TYPES}
      recordType="creature"
      texts={artifactRelationsTexts(translator(language))}
      language={language}
      relateAction={record('relate', options.relate ?? { serial: 1, done: true, error: null })}
      unrelateAction={record('unrelate', options.unrelate ?? { serial: 1, done: true, error: null })}
      load={load}
    />,
  );
  return { ...view, asked, posted, load };
}

describe('"Relacionados" on an artifact\'s page and the picker\'s related mode (Story 5.5 part B)', () => {
  it('by keyboard: it opens on the name filter, Tab reaches the type, every row and the pager, and Esc gives focus back', async () => {
    const user = userEvent.setup();
    const { asked } = renderSection();
    expect(screen.getByText('Não está relacionado a nenhum registro.')).toBeTruthy();
    const opener = screen.getByRole('button', { name: 'Relacionar um registro' });
    await user.tab();
    expect(document.activeElement).toBe(opener);
    await user.keyboard('{Enter}');
    const dialog = screen.getByRole('dialog', { name: 'Relacionar um registro' });
    expect(document.activeElement).toBe(within(dialog).getByRole('searchbox', { name: 'Filtrar por nome' }));
    await vi.waitFor(() => expect(within(dialog).getAllByRole('radio')).toHaveLength(2));
    expect(asked[0]).toEqual({ artifactId: ARTIFACT, recordType: 'creature', query: '', page: 1 });
    expect((within(dialog).getByRole('combobox', { name: 'Tipo de registro' }) as HTMLSelectElement).value).toBe('creature');

    const order: string[] = [];
    for (let step = 0; step < 7; step += 1) {
      await user.tab();
      const active = document.activeElement as HTMLElement;
      expect(dialog.contains(active)).toBe(true);
      order.push(active.getAttribute('aria-label') ?? (active.closest('label')?.textContent || active.textContent) ?? '');
    }
    // Each row reads its tier first: the pill's word, then the hidden ": ".
    expect(order).toEqual(
      [
        'Campanha: GuardaArtefato desta campanha',
        'Sistema: TrollMonstros',
        'Anterior',
        'Próxima',
        'Cancelar',
        'Relacionar',
        'Tipo de registro',
      ].map((text, index) => (index === 2 || index === 3 || index === 6 ? expect.stringContaining(text) : text)),
    );
    await user.keyboard('{Escape}');
    expect(dialog.hasAttribute('open')).toBe(false);
    expect(document.activeElement).toBe(opener);
  });

  it('"Relacionar" posts the record picked, and the picker closes once it is stored; one asked loader per opening', async () => {
    const user = userEvent.setup();
    const { posted, asked } = renderSection();
    await user.click(screen.getByRole('button', { name: 'Relacionar um registro' }));
    const dialog = screen.getByRole('dialog');
    await vi.waitFor(() => expect(within(dialog).getAllByRole('radio')).toHaveLength(2));
    await user.click(within(dialog).getByRole('button', { name: 'Relacionar' }));
    expect(within(dialog).getByRole('alert').textContent).toBe('Escolha um registro da lista.');

    await user.click(within(dialog).getByRole('button', { name: /Próxima/ }));
    await vi.waitFor(() => expect(within(dialog).getAllByRole('radio').map((radio) => radio.closest('label')?.textContent)).toEqual(['Outros: LoboOutro']));
    await user.click(within(dialog).getByRole('radio'));
    await user.click(within(dialog).getByRole('button', { name: 'Relacionar' }));
    await vi.waitFor(() => expect(posted).toEqual([{ action: 'relate', fields: { campaignId: CAMPAIGN, artifactId: ARTIFACT, recordId: TARGETS[2]!.id } }]));
    await vi.waitFor(() => expect(dialog.hasAttribute('open')).toBe(false));
    // The section's renders never asked the same page again: two pages read, no more.
    expect(asked).toHaveLength(2);
  });

  it('a refusal of "Relacionar" shows in the picker, which stays open', async () => {
    const user = userEvent.setup();
    renderSection({ relate: { serial: 1, done: false, error: 'Este artefato, ou o outro, já tem 50 relações: remova uma antes.' } });
    await user.click(screen.getByRole('button', { name: 'Relacionar um registro' }));
    const dialog = screen.getByRole('dialog');
    await vi.waitFor(() => expect(within(dialog).getAllByRole('radio')).toHaveLength(2));
    await user.click(within(dialog).getAllByRole('radio')[0]!);
    await user.click(within(dialog).getByRole('button', { name: 'Relacionar' }));
    await vi.waitFor(() =>
      expect(within(dialog).getByRole('alert').textContent).toBe('Este artefato, ou o outro, já tem 50 relações: remova uma antes.'),
    );
    expect(dialog.hasAttribute('open')).toBe(true);
    await user.selectOptions(within(dialog).getByRole('combobox'), 'note');
    await vi.waitFor(() => expect(within(dialog).getByRole('status').textContent).toBe('Nenhum registro deste tipo no escopo desta campanha.'));
  });

  it('lists each relation with its tier, link and type; a removed one has no link; "Remover" posts that record', async () => {
    const user = userEvent.setup();
    const gone: Shown = { ...TROLL, recordId: TARGETS[2]!.id, name: 'Lobo', tier: null, href: `/search/records/${TARGETS[2]!.id}`, removed: true };
    const { posted } = renderSection({ related: [TROLL, MAP, gone] });
    const list = screen.getByRole('list', { name: 'Registros relacionados' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual([
      'Sistema: Troll · CriaturaRemover',
      'Campanha: Mapa · NotaRemover',
      'Lobo · Criatura · fora do escopo da campanha ou excluídoRemover',
    ]);
    expect(within(rows[0]!).getByRole('link', { name: 'Troll' }).getAttribute('href')).toBe(TROLL.href);
    expect(within(rows[1]!).getByRole('link', { name: 'Mapa' }).getAttribute('href')).toBe(MAP.href);
    expect(within(rows[2]!).queryByRole('link')).toBeNull();
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Remover a relação com Mapa' }));
    });
    await vi.waitFor(() => expect(posted).toEqual([{ action: 'unrelate', fields: { campaignId: CAMPAIGN, artifactId: ARTIFACT, recordId: MAP.recordId } }]));
  });

  it('a refused removal shows as an alert; it speaks English too', async () => {
    const user = userEvent.setup();
    renderSection({ language: 'en', related: [TROLL], unrelate: { serial: 1, done: false, error: 'Not found.' } });
    expect(screen.getByRole('heading', { name: 'Related' })).toBeTruthy();
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Remove the relation with Troll' }));
    });
    await vi.waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Not found.'));
    expect(screen.getByRole('button', { name: 'Relate a record' })).toBeTruthy();
  });
});

describe('"Relacionados" on a campaign\'s record page (Story 5.5 part B)', () => {
  it('lists the related artifacts as links with their type, and shows nothing when there is none', () => {
    const { container, rerender } = render(<RecordRelated rows={[]} heading="Relacionados" label="Artefatos relacionados" />);
    expect(container.innerHTML).toBe('');
    rerender(
      <RecordRelated
        rows={[{ artifactId: ARTIFACT, href: `/campaigns/${CAMPAIGN}/artifacts/${ARTIFACT}`, name: 'Cripta', typeLabel: 'Encontro' }]}
        heading="Relacionados"
        label="Artefatos relacionados"
      />,
    );
    expect(screen.getByRole('heading', { name: 'Relacionados' })).toBeTruthy();
    const list = screen.getByRole('list', { name: 'Artefatos relacionados' });
    expect(within(list).getByRole('listitem').textContent).toBe('Cripta · Encontro');
    expect(within(list).getByRole('link', { name: 'Cripta' }).getAttribute('href')).toBe(`/campaigns/${CAMPAIGN}/artifacts/${ARTIFACT}`);
  });
});
