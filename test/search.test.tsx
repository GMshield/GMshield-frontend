import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const replace = vi.fn();
const push = vi.fn();
// One router for every render, as Next.js gives.
const router = { replace, push, refresh: vi.fn() };
vi.mock('next/navigation', () => ({
  usePathname: () => '/search',
  useRouter: () => router,
}));

const { SearchPage, POLL_LIMIT_MS, typeOptionsOf } = await import('@/components/search/SearchPage');
const { searchAddressOf } = await import('@/components/search/search-params');
const { SourceView } = await import('@/components/SourceView');
const { focusSearchField, searchHref, searchRecordHref } = await import('@/components/search/search-address');
const ptBR = (await import('@/messages/pt-BR.json')).default;
const en = (await import('@/messages/en.json')).default;

type Search = import('@/client/search').Search;
type PassageResult = import('@/client/search').PassageResult;
type RecordResult = import('@/client/search').RecordResult;
type Scope = import('@/components/scope').Scope;
type SearchCalls = import('@/components/search/SearchPage').SearchCalls;

const CAMPAIGN = '0190a0b0-0000-7000-8000-000000000002';
const SEARCH = '0190a0b0-0000-7000-8000-000000000072';
const VERSION = '0190a0b0-0000-7000-8000-000000000071';
const NOTES = '0190a0b0-0000-7000-8000-000000000060';
const BOOK = '0190a0b0-0000-7000-8000-000000000003';
const GUIDE = '0190a0b0-0000-7000-8000-000000000061';

const SCOPE: Scope = {
  version: 0,
  campaignTier: true,
  systemTier: true,
  otherTier: false,
  modelKnowledge: false,
  materials: [
    { id: NOTES, name: 'Notas da campanha.md', tier: 'campaign', on: true },
    { id: BOOK, name: 'Livro do Jogador.pdf', tier: 'campaign', on: false },
    { id: GUIDE, name: 'Guia do Mestre.pdf', tier: 'system', on: true },
    { id: '0190a0b0-0000-7000-8000-000000000062', name: 'Bestiário de outra mesa.pdf', tier: 'other', on: true },
  ],
};

function result(index: number, overrides: Partial<PassageResult> = {}): PassageResult {
  return {
    kind: 'passage',
    passageId: `0190a0b0-0000-7000-8000-0000000001${String(index).padStart(2, '0')}`,
    versionId: VERSION,
    materialName: 'Livro do Jogador.pdf',
    sectionPath: ['Magias', 'Fire Bolt'],
    page: 10 + index,
    firstWords: `Trecho ${index} sobre Fire Bolt`,
    tier: index % 2 === 0 ? 'campaign' : 'system',
    ...overrides,
  };
}

function search(overrides: Partial<Search> = {}): Search {
  return {
    id: SEARCH,
    campaignId: CAMPAIGN,
    query: 'Fire Bolt',
    tier: null,
    materialId: null,
    recordType: null,
    state: 'done',
    results: [result(1)],
    ...overrides,
  };
}

const PAGE = {
  page: 11,
  pageTotal: 40,
  picture: null,
  lines: [],
  text: '# Magias\n\nFire Bolt causa 1d10.',
  passages: [{ id: result(1).passageId, range: [10, 31] as [number, number] }],
  outcome: 'read_directly',
};

/** The search's calls, scripted: `reads` answers the reads in turn (the last one repeats). */
function calls(reads: Awaited<ReturnType<SearchCalls['read']>>[], extra: Partial<SearchCalls> = {}) {
  let index = 0;
  const start = vi.fn<SearchCalls['start']>(async () => ({ ok: true, id: SEARCH }));
  const read = vi.fn<SearchCalls['read']>(async () => reads[Math.min(index++, reads.length - 1)]!);
  const loadPage = vi.fn(async () => PAGE);
  const wait = vi.fn<NonNullable<SearchCalls['wait']>>(async () => undefined);
  // An override given in `extra` is a mock of the same call.
  return { start, read, loadPage, wait, ...extra } as { start: typeof start; read: typeof read; loadPage: typeof loadPage; wait: typeof wait; now?: () => number };
}

function page(props: Partial<Parameters<typeof SearchPage>[0]> = {}) {
  return (
    <SearchPage
      language="pt-BR"
      campaignId={CAMPAIGN}
      query="Fire Bolt"
      searchId={SEARCH}
      tier={null}
      materialId={null}
      page={1}
      scope={SCOPE}
      {...props}
    />
  );
}

beforeEach(() => {
  replace.mockClear();
  push.mockClear();
});

afterEach(() => {
  cleanup();
});

describe('the search page (Story 3.9)', () => {
  it('starts a search of the query and the filters, then names it in the address so a reload reads it', async () => {
    const scripted = calls([{ ok: true, search: search() }]);
    const { rerender } = render(page({ searchId: null, tier: 'campaign', materialId: NOTES, calls: scripted }));

    // Meanwhile a muted line says it is searching.
    expect(screen.getByRole('status').textContent).toBe('Procurando nas fontes…');
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    expect(scripted.start).toHaveBeenCalledExactlyOnceWith(CAMPAIGN, 'Fire Bolt', { tier: 'campaign', materialId: NOTES, recordType: null });
    expect(replace).toHaveBeenCalledWith(`/search?q=Fire+Bolt&s=${SEARCH}&tier=campaign&material=${NOTES}`, { scroll: false });
    expect(scripted.read).not.toHaveBeenCalled();

    rerender(page({ tier: 'campaign', materialId: NOTES, calls: scripted }));

    await screen.findByRole('list', { name: 'Resultados' });
    expect(scripted.read).toHaveBeenCalledTimes(1);
    expect(scripted.start).toHaveBeenCalledTimes(1);
  });

  it('reads a pending search again every 500 ms until it is done, saying it is searching meanwhile', async () => {
    const pending = { ok: true as const, search: search({ state: 'pending', results: [] }) };
    const scripted = calls([pending, pending, { ok: true, search: search() }]);
    render(page({ calls: scripted }));

    await screen.findByRole('list', { name: 'Resultados' });
    expect(scripted.read).toHaveBeenCalledTimes(3);
    expect(scripted.wait).toHaveBeenCalledTimes(2);
    expect(scripted.wait.mock.calls.map(([ms]) => ms)).toEqual([500, 500]);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows each result with its first words, its tier and its place, ten a page with the shared pager', async () => {
    const results = Array.from({ length: 13 }, (_, index) => result(index + 1));
    const scripted = calls([{ ok: true, search: search({ results }) }]);
    const { rerender } = render(page({ calls: scripted }));

    const list = await screen.findByRole('list', { name: 'Resultados' });
    const rows = within(list).getAllByRole('button');
    expect(rows).toHaveLength(10);
    expect(rows[0]!.textContent).toBe('Trecho 1 sobre Fire BoltSistema: Livro do Jogador.pdf, Magias › Fire Bolt, p. 11');
    expect(rows[1]!.textContent).toContain('Campanha: ');
    expect(rows[0]!.getAttribute('aria-haspopup')).toBe('dialog');
    expect(screen.getByText('1–10 de 13')).toBeTruthy();
    const next = screen.getByRole('link', { name: /Próxima/ });
    expect(next.getAttribute('href')).toBe(`/search?q=Fire+Bolt&s=${SEARCH}&page=2`);

    // The second page reads the stored search no more.
    rerender(page({ page: 2, calls: scripted }));
    expect(within(screen.getByRole('list', { name: 'Resultados' })).getAllByRole('button')).toHaveLength(3);
    expect(screen.getByRole('list', { name: 'Resultados' }).getAttribute('start')).toBe('11');
    expect(scripted.read).toHaveBeenCalledTimes(1);
  });

  it('opens the source view at the result\'s page on the ground of the current scope, its passage marked; Esc gives focus back to the result', async () => {
    const user = userEvent.setup();
    const scripted = calls([{ ok: true, search: search() }]);
    render(page({ calls: scripted }));
    const row = within(await screen.findByRole('list', { name: 'Resultados' })).getByRole('button');

    row.focus();
    await user.keyboard('{Enter}');

    const view = await screen.findByRole('dialog', { name: 'Livro do Jogador.pdf, Magias › Fire Bolt' });
    expect(scripted.loadPage).toHaveBeenCalledWith(CAMPAIGN, VERSION, 11, expect.any(AbortSignal));
    const cited = await within(view).findByText('Fire Bolt causa 1d10.');
    expect(cited.tagName.toLowerCase()).toBe('mark');
    expect(within(view).getByText('p. 11')).toBeTruthy();
    expect(document.activeElement).toBe(within(view).getByRole('button', { name: ptBR.conversation.close }));
    expect(row.getAttribute('data-open')).toBe('true');

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(row);
    expect(row.getAttribute('data-open')).toBeNull();
  });

  it('Story 3.12: the saved items panel opened over the source view closes it, and focus stays in the new panel', async () => {
    const { SavedItemsProvider } = await import('@/components/saved/SavedItems');
    const { SavedItemsPanel } = await import('@/components/saved/SavedItemsPanel');
    const { ShellFrame } = await import('@/components/ShellPanel');
    const user = userEvent.setup();
    render(
      <SavedItemsProvider currentCampaignId={CAMPAIGN}>
        <ShellFrame>
          {page({ calls: calls([{ ok: true, search: search() }]) })}
          <SavedItemsPanel language="pt-BR" action={async (previous) => previous} load={async () => ({ ok: true, items: [], total: 0 })} />
        </ShellFrame>
      </SavedItemsProvider>,
    );
    const row = within(await screen.findByRole('list', { name: 'Resultados' })).getByRole('button');
    await user.click(row);
    expect(await screen.findByRole('dialog', { name: 'Livro do Jogador.pdf, Magias › Fire Bolt' })).toBeTruthy();

    await user.keyboard('{Control>}{Shift>}s{/Shift}{/Control}');

    expect(screen.queryByRole('dialog', { name: 'Livro do Jogador.pdf, Magias › Fire Bolt' })).toBeNull();
    expect(screen.getAllByRole('complementary')).toHaveLength(1);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: ptBR.saved.close }));
    expect(row.getAttribute('data-open')).toBeNull();
  });

  it('says a search that found nothing in one sentence naming the scope searched, filters included', async () => {
    render(page({ calls: calls([{ ok: true, search: search({ results: [] }) }]) }));
    expect(await screen.findByText('Nada encontrado para «Fire Bolt» em Campanha + Sistema.')).toBeTruthy();
    cleanup();

    render(page({ tier: 'system', materialId: GUIDE, calls: calls([{ ok: true, search: search({ results: [], tier: 'system', materialId: GUIDE }) }]) }));
    expect(await screen.findByText('Nada encontrado para «Fire Bolt» em Campanha + Sistema, só Sistema, Guia do Mestre.pdf.')).toBeTruthy();
    cleanup();

    render(page({ language: 'en', scope: { ...SCOPE, systemTier: false }, calls: calls([{ ok: true, search: search({ results: [] }) }]) }));
    expect(await screen.findByText('Nothing found for “Fire Bolt” in Campaign.')).toBeTruthy();
  });

  it('offers chips for the tiers switched on only, and the materials switched on in them; a change starts a narrowed search from page 1', async () => {
    const user = userEvent.setup();
    render(page({ page: 2, calls: calls([{ ok: true, search: search() }]) }));
    await screen.findByRole('list', { name: 'Resultados' });

    const chips = screen.getByRole('navigation', { name: ptBR.search.tiers });
    expect(within(chips).getAllByRole('link').map((chip) => [chip.textContent, chip.getAttribute('href'), chip.getAttribute('aria-current')])).toEqual([
      ['Todas', '/search?q=Fire+Bolt', 'page'],
      ['Campanha', '/search?q=Fire+Bolt&tier=campaign', null],
      ['Sistema', '/search?q=Fire+Bolt&tier=system', null],
    ]);
    const select = screen.getByRole('combobox', { name: ptBR.search.material }) as HTMLSelectElement;
    expect([...select.options].map((option) => option.textContent)).toEqual(['Todos os materiais', 'Notas da campanha.md', 'Guia do Mestre.pdf']);

    await user.selectOptions(select, GUIDE);

    expect(push).toHaveBeenCalledExactlyOnceWith(`/search?q=Fire+Bolt&material=${GUIDE}`);
    cleanup();

    // With a tier chosen, its own materials only.
    render(page({ tier: 'campaign', calls: calls([{ ok: true, search: search({ tier: 'campaign' }) }]) }));
    await screen.findByRole('list', { name: 'Resultados' });
    expect(within(screen.getByRole('navigation', { name: ptBR.search.tiers })).getByRole('link', { name: 'Campanha' }).getAttribute('aria-current')).toBe('page');
    expect([...(screen.getByRole('combobox', { name: ptBR.search.material }) as HTMLSelectElement).options].map((option) => option.textContent)).toEqual([
      'Todos os materiais',
      'Notas da campanha.md',
    ]);
  });

  it('says a failed search with "Tentar de novo", which starts it again', async () => {
    const user = userEvent.setup();
    const scripted = calls([{ ok: true, search: search({ state: 'failed', code: 'retrieval.store_unavailable', results: [] }) }]);
    render(page({ calls: scripted }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('A busca não pôde terminar.');
    await user.click(within(alert).getByRole('button', { name: 'Tentar de novo' }));

    expect(scripted.start).toHaveBeenCalledExactlyOnceWith(CAMPAIGN, 'Fire Bolt', { tier: null, materialId: null, recordType: null });
    await waitFor(() => expect(replace).toHaveBeenCalledWith(`/search?q=Fire+Bolt&s=${SEARCH}`, { scroll: false }));
  });

  it('stops reading after 30 s and says the search took too long, with "Tentar de novo"', async () => {
    let clock = 0;
    const pending = { ok: true as const, search: search({ state: 'pending', results: [] }) };
    const scripted = calls([pending], {
      now: () => clock,
      wait: vi.fn(async (ms: number) => {
        clock += ms;
      }),
    });
    render(page({ calls: scripted }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(ptBR.search.timeout);
    expect(within(alert).getByRole('button', { name: 'Tentar de novo' })).toBeTruthy();
    expect(scripted.read).toHaveBeenCalledTimes(POLL_LIMIT_MS / 500 + 1);
  });

  it('says another account\'s search, or one that is gone, is not found when there is no query; an unavailable service with "Tentar de novo"', async () => {
    render(page({ query: '', calls: calls([{ ok: false, status: 404, problem: { code: 'request.not_found' } }]) }));
    expect(await screen.findByText('Não encontrado.')).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
    cleanup();
    render(page({ calls: calls([{ ok: false, status: 503, problem: { status: 503, category: 'server', code: 'server.unavailable', params: {} } }]) }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(ptBR.errors.codes.server.unavailable);
  });

  it('searches the query again when its stored search is gone (pruned, or reached by Back or a bookmark)', async () => {
    const scripted = calls([{ ok: false, status: 404, problem: { code: 'request.not_found' } }]);
    render(page({ tier: 'system', materialId: GUIDE, calls: scripted }));

    await waitFor(() => expect(replace).toHaveBeenCalledExactlyOnceWith(`/search?q=Fire+Bolt&tier=system&material=${GUIDE}`, { scroll: false }));
    expect(screen.queryByText('Não encontrado.')).toBeNull();
  });

  it('reads the stored search again when the scope changes, keeping the results shown until the new answer', async () => {
    let answerNext: (value: Awaited<ReturnType<SearchCalls['read']>>) => void = () => undefined;
    const read = vi
      .fn<SearchCalls['read']>()
      .mockResolvedValueOnce({ ok: true, search: search({ results: [result(1), result(2)] }) })
      .mockImplementationOnce(() => new Promise((resolve) => (answerNext = resolve)));
    const scripted = calls([], { read });
    const { rerender } = render(page({ calls: scripted }));
    const list = await screen.findByRole('list', { name: 'Resultados' });
    expect(within(list).getAllByRole('button')).toHaveLength(2);
    // A page turned or the same scope: no read.
    rerender(page({ calls: scripted, scope: { ...SCOPE } }));
    expect(read).toHaveBeenCalledTimes(1);

    // A switch in the scope popover: the layout renders the page with the scope's next version.
    rerender(page({ calls: scripted, scope: { ...SCOPE, version: 1, materials: SCOPE.materials.map((material) => ({ ...material, on: false })) } }));

    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(within(screen.getByRole('list', { name: 'Resultados' })).getAllByRole('button')).toHaveLength(2);
    await act(async () => answerNext({ ok: true, search: search({ results: [result(2)] }) }));
    expect(within(screen.getByRole('list', { name: 'Resultados' })).getAllByRole('button')).toHaveLength(1);
  });

  it('names its own search landmark apart from the context bar\'s', () => {
    render(page({ calls: calls([{ ok: true, search: search() }]) }));
    expect(screen.getByRole('search', { name: ptBR.search.field })).toBeTruthy();
  });

  it('refuses a blank or too long query beside the field, the backend\'s refusal too', async () => {
    const user = userEvent.setup();
    const scripted = calls([{ ok: true, search: search() }], {
      start: vi.fn<SearchCalls['start']>(async () => ({ ok: false, status: 400, problem: { code: 'request.invalid' } })),
    });
    render(page({ searchId: null, calls: scripted }));
    const field = screen.getByRole('searchbox', { name: ptBR.search.field }) as HTMLInputElement;

    await waitFor(() => expect(field.getAttribute('aria-invalid')).toBe('true'));
    const error = document.getElementById(field.getAttribute('aria-describedby') ?? '');
    expect(error?.textContent).toBe(ptBR.search.invalid);
    expect(replace).not.toHaveBeenCalled();

    await user.clear(field);
    await user.click(field);
    await user.paste('😀'.repeat(501));
    await user.keyboard('{Enter}');
    expect(push).not.toHaveBeenCalled();
    expect(field.getAttribute('aria-invalid')).toBe('true');
  });

  it('has its own field, prefilled with the query: Enter searches again with the filters, Esc clears it', async () => {
    const user = userEvent.setup();
    render(page({ tier: 'system', calls: calls([{ ok: true, search: search() }]) }));
    const field = screen.getByRole('searchbox', { name: ptBR.search.field }) as HTMLInputElement;
    expect(field.value).toBe('Fire Bolt');
    expect(field.dataset.searchField).toBe('page');
    expect(field.closest('form')?.getAttribute('action')).toBe('/search');

    await user.click(field);
    await user.keyboard('{Escape}');
    expect(field.value).toBe('');
    await user.keyboard(' Espada Vorpal {Enter}');

    expect(push).toHaveBeenCalledExactlyOnceWith('/search?q=Espada+Vorpal&tier=system');
  });

  it('with no query, asks for one and searches nothing', () => {
    const scripted = calls([{ ok: true, search: search() }]);
    render(page({ query: '', searchId: null, calls: scripted }));
    expect(screen.getByText(ptBR.search.start)).toBeTruthy();
    expect(scripted.start).not.toHaveBeenCalled();
  });

  it('searches the current campaign again when the stored search is of another (the GM switched since)', async () => {
    const scripted = calls([{ ok: true, search: search({ campaignId: '0190a0b0-0000-7000-8000-000000000099' }) }]);
    render(page({ calls: scripted }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/search?q=Fire+Bolt', { scroll: false }));
    expect(screen.queryByRole('list', { name: 'Resultados' })).toBeNull();
  });

  it('has every string in English too', async () => {
    render(page({ language: 'en', calls: calls([{ ok: true, search: search() }]) }));
    await screen.findByRole('list', { name: en.search.results });
    expect(screen.getByRole('searchbox', { name: en.search.field })).toBeTruthy();
    expect(screen.getByRole('button', { name: en.search.submit })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: en.search.tiers })).toBeTruthy();
    expect(Object.keys(en.search).sort()).toEqual(Object.keys(ptBR.search).sort());
    expect(Object.keys(en.shell.search).sort()).toEqual(Object.keys(ptBR.shell.search).sort());
  });

  it('styles its field as a bordered box and its rows in a bordered list, with tokens only', () => {
    const css = readFileSync(join(process.cwd(), 'src/components/search/SearchPage.module.css'), 'utf8');
    expect(css).toMatch(/\.input \{[^}]*border: 1px solid var\(--color-field-border\);/);
    expect(css).toMatch(/\.results \{[^}]*border: 1px solid var\(--color-border\);/);
    expect(css).not.toMatch(/#[0-9a-f]{3,6}\b/i);
  });
});

describe('records in the search (Story 4.3 part B)', () => {
  const RECORD = '0190a0b0-0000-7000-8000-000000000700';

  function recordResult(overrides: Partial<RecordResult> = {}): RecordResult {
    return {
      kind: 'record',
      recordId: RECORD,
      versionId: VERSION,
      materialName: 'Guia do Mestre.pdf',
      sectionPath: ['Itens mágicos'],
      page: 209,
      name: 'Vorpal Sword',
      recordType: 'item',
      passageIds: ['0190a0b0-0000-7000-8000-000000000811'],
      tier: 'system',
      ...overrides,
    };
  }

  it('shows a record result with its name, its type, its tier and its place, a link to its page that keeps the search', async () => {
    const results = [recordResult(), result(1), recordResult({ recordId: `${RECORD.slice(0, -1)}1`, name: 'Bola de Fogo', recordType: 'spell', tier: 'campaign' })];
    render(page({ query: 'vorpal sword', tier: 'system', recordType: null, page: 1, calls: calls([{ ok: true, search: search({ query: 'vorpal sword', tier: 'system', results }) }]) }));

    const list = await screen.findByRole('list', { name: 'Resultados' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    // The record is a link, not a button: it opens the record's page, the search's address kept for its way back.
    const link = within(items[0]!).getByRole('link');
    expect(link.textContent).toBe('Vorpal SwordItem, Sistema: Guia do Mestre.pdf, Itens mágicos, p. 209');
    expect(link.getAttribute('href')).toBe(`/search/records/${RECORD}?q=vorpal+sword&s=${SEARCH}&tier=system`);
    expect(link.getAttribute('aria-haspopup')).toBeNull();
    // The passage keeps its row, which opens the source view.
    expect(within(items[1]!).getByRole('button').getAttribute('aria-haspopup')).toBe('dialog');
    expect(within(items[2]!).getByRole('link').textContent).toBe('Bola de FogoMagia, Campanha: Guia do Mestre.pdf, Itens mágicos, p. 209');
    cleanup();

    // In English, and on the second page of results the link keeps the page too.
    const many: (PassageResult | RecordResult)[] = [...Array.from({ length: 10 }, (_, index) => result(index + 1)), recordResult()];
    render(page({ language: 'en', query: 'vorpal sword', page: 2, calls: calls([{ ok: true, search: search({ query: 'vorpal sword', results: many }) }]) }));
    const second = await screen.findByRole('link', { name: /Vorpal Sword/ });
    expect(second.textContent).toBe('Vorpal SwordItem, System: Guia do Mestre.pdf, Itens mágicos, p. 209');
    expect(second.getAttribute('href')).toBe(`/search/records/${RECORD}?q=vorpal+sword&s=${SEARCH}&page=2`);
  });

  it('opens a record result from the keyboard: Tab reaches its link, a passage row keeps its button', async () => {
    const user = userEvent.setup();
    render(page({ calls: calls([{ ok: true, search: search({ results: [result(1), recordResult()] }) }]) }));
    const list = await screen.findByRole('list', { name: 'Resultados' });
    within(list).getByRole('button').focus();
    await user.tab();
    expect(document.activeElement).toBe(within(list).getByRole('link'));
  });

  it('offers the eight core types beside the material select; a choice starts a search of that type from page 1, with the other filters', async () => {
    const user = userEvent.setup();
    render(page({ tier: 'system', materialId: GUIDE, page: 2, calls: calls([{ ok: true, search: search({ tier: 'system', materialId: GUIDE }) }]) }));
    await screen.findByRole('list', { name: 'Resultados' });

    const select = screen.getByRole('combobox', { name: ptBR.search.type }) as HTMLSelectElement;
    expect([...select.options].map((option) => [option.value, option.textContent])).toEqual([
      ['', 'Todos os tipos'],
      ['rule', 'Regra'],
      ['spell', 'Magia'],
      ['item', 'Item'],
      ['creature', 'Criatura'],
      ['character_sheet', 'Ficha de personagem'],
      ['encounter', 'Encontro'],
      ['dungeon', 'Masmorra'],
      ['note', 'Nota'],
    ]);
    expect(select.value).toBe('');

    await user.selectOptions(select, 'spell');

    expect(push).toHaveBeenCalledExactlyOnceWith(`/search?q=Fire+Bolt&tier=system&material=${GUIDE}&type=spell`);
    cleanup();
    push.mockClear();

    // With a type chosen: it is selected, the chips and the material keep it, and "Todos os tipos" leaves it.
    render(page({ recordType: 'spell', calls: calls([{ ok: true, search: search({ recordType: 'spell' }) }]) }));
    await screen.findByRole('list', { name: 'Resultados' });
    const chosen = screen.getByRole('combobox', { name: ptBR.search.type }) as HTMLSelectElement;
    expect(chosen.value).toBe('spell');
    expect(within(screen.getByRole('navigation', { name: ptBR.search.tiers })).getByRole('link', { name: 'Sistema' }).getAttribute('href')).toBe(
      '/search?q=Fire+Bolt&tier=system&type=spell',
    );
    await user.selectOptions(screen.getByRole('combobox', { name: ptBR.search.material }), NOTES);
    expect(push).toHaveBeenLastCalledWith(`/search?q=Fire+Bolt&material=${NOTES}&type=spell`);
    await user.selectOptions(chosen, '');
    expect(push).toHaveBeenLastCalledWith('/search?q=Fire+Bolt');
  });

  it('starts the search with its type, names it in the address, and says a search of a type that found nothing naming the scope and the type', async () => {
    const scripted = calls([{ ok: true, search: search({ recordType: 'item', results: [] }) }]);
    const { rerender } = render(page({ searchId: null, recordType: 'item', calls: scripted }));
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    expect(scripted.start).toHaveBeenCalledExactlyOnceWith(CAMPAIGN, 'Fire Bolt', { tier: null, materialId: null, recordType: 'item' });
    expect(replace).toHaveBeenCalledWith(`/search?q=Fire+Bolt&s=${SEARCH}&type=item`, { scroll: false });

    rerender(page({ recordType: 'item', calls: scripted }));
    expect(await screen.findByText('Nada encontrado para «Fire Bolt» em Campanha + Sistema, só Item.')).toBeTruthy();
    cleanup();
    render(page({ language: 'en', tier: 'system', recordType: 'item', calls: calls([{ ok: true, search: search({ recordType: 'item', results: [] }) }]) }));
    expect(await screen.findByText('Nothing found for “Fire Bolt” in Campaign + System, only System, Item.')).toBeTruthy();
  });

  it('keeps the type select with no tier on, and keeps the type in the field\'s own search', async () => {
    const user = userEvent.setup();
    render(page({ recordType: 'note', scope: { ...SCOPE, campaignTier: false, systemTier: false }, calls: calls([{ ok: true, search: search() }]) }));
    await screen.findByRole('list', { name: 'Resultados' });
    expect(screen.queryByRole('navigation', { name: ptBR.search.tiers })).toBeNull();
    expect((screen.getByRole('combobox', { name: ptBR.search.type }) as HTMLSelectElement).value).toBe('note');
    const field = screen.getByRole('searchbox', { name: ptBR.search.field });
    await user.clear(field);
    await user.type(field, 'Luz{Enter}');
    expect(push).toHaveBeenLastCalledWith('/search?q=Luz&type=note');
  });

  it('keeps the type when it searches again: a gone search, another campaign\'s, and the pager\'s next page', async () => {
    render(page({ recordType: 'spell', calls: calls([{ ok: false, status: 404, problem: { code: 'request.not_found' } }]) }));
    await waitFor(() => expect(replace).toHaveBeenCalledExactlyOnceWith('/search?q=Fire+Bolt&type=spell', { scroll: false }));
    cleanup();
    replace.mockClear();

    render(page({ recordType: 'spell', calls: calls([{ ok: true, search: search({ recordType: 'spell', campaignId: '0190a0b0-0000-7000-8000-000000000099' }) }]) }));
    await waitFor(() => expect(replace).toHaveBeenCalledExactlyOnceWith('/search?q=Fire+Bolt&type=spell', { scroll: false }));
    cleanup();

    const many = Array.from({ length: 11 }, (_, index) => recordResult({ recordId: `0190a0b0-0000-7000-8000-0000000007${String(index + 10)}`, recordType: 'spell' }));
    render(page({ recordType: 'spell', calls: calls([{ ok: true, search: search({ recordType: 'spell', results: many }) }]) }));
    await screen.findByRole('list', { name: 'Resultados' });
    expect(screen.getByRole('link', { name: /Próxima/ }).getAttribute('href')).toBe(`/search?q=Fire+Bolt&s=${SEARCH}&type=spell&page=2`);
  });

  it('writes a record result\'s address with the search\'s, the first page left out', () => {
    expect(searchRecordHref(RECORD, { query: '' })).toBe(`/search/records/${RECORD}`);
    expect(searchRecordHref(RECORD, { query: 'x', searchId: SEARCH, tier: 'other', materialId: NOTES, recordType: 'rule', page: 2 })).toBe(
      `/search/records/${RECORD}?q=x&s=${SEARCH}&tier=other&material=${NOTES}&type=rule&page=2`,
    );
    expect(searchHref({ query: 'x', recordType: 'dungeon', page: 1 })).toBe('/search?q=x&type=dungeon');
  });
});

describe('records of a type the GM approved in the search (Story 4.4 part B)', () => {
  const TYPES = [
    { key: 'rule', name: 'rule' },
    { key: 'spell', name: 'spell' },
    { key: 'item', name: 'item' },
    { key: 'talento', name: 'Talento' },
  ];
  const talent: RecordResult = {
    kind: 'record',
    recordId: '0190a0b0-0000-7000-8000-000000000703',
    versionId: VERSION,
    materialName: 'Livro do Jogador.pdf',
    sectionPath: ['Talentos'],
    page: 168,
    name: 'Conjurador de Guerra',
    recordType: 'talento',
    passageIds: ['0190a0b0-0000-7000-8000-000000000814'],
    tier: 'system',
  };

  it('names a record of an approved type by the system\'s type, and a key with no match as it is', async () => {
    const other: RecordResult = { ...talent, recordId: '0190a0b0-0000-7000-8000-000000000704', name: 'Sortudo', recordType: 'vantagem' };
    render(page({ recordTypes: TYPES, calls: calls([{ ok: true, search: search({ results: [talent, other] }) }]) }));
    const list = await screen.findByRole('list', { name: 'Resultados' });
    const links = within(list).getAllByRole('link');
    expect(links[0]!.textContent).toBe('Conjurador de GuerraTalento, Sistema: Livro do Jogador.pdf, Talentos, p. 168');
    expect(links[1]!.textContent).toBe('Sortudovantagem, Sistema: Livro do Jogador.pdf, Talentos, p. 168');
  });

  it('offers the campaign system\'s types by name, the core ones translated, and a choice searches that key', async () => {
    const user = userEvent.setup();
    render(page({ recordTypes: TYPES, calls: calls([{ ok: true, search: search() }]) }));
    await screen.findByRole('list', { name: 'Resultados' });
    const select = screen.getByRole('combobox', { name: ptBR.search.type }) as HTMLSelectElement;
    expect([...select.options].map((option) => [option.value, option.textContent])).toEqual([
      ['', 'Todos os tipos'],
      ['rule', 'Regra'],
      ['spell', 'Magia'],
      ['item', 'Item'],
      ['talento', 'Talento'],
    ]);
    await user.selectOptions(select, 'talento');
    expect(push).toHaveBeenCalledExactlyOnceWith('/search?q=Fire+Bolt&type=talento');
    cleanup();

    // A search of the type that found nothing names it; a key of the address the list lacks stays selectable.
    render(page({ recordType: 'talento', recordTypes: TYPES, calls: calls([{ ok: true, search: search({ recordType: 'talento', results: [] }) }]) }));
    expect(await screen.findByText(/Talento/)).toBeTruthy();
    cleanup();
    render(page({ recordType: 'vantagem', recordTypes: TYPES, calls: calls([{ ok: true, search: search({ recordType: 'vantagem' }) }]) }));
    await screen.findByRole('list', { name: 'Resultados' });
    const kept = screen.getByRole('combobox', { name: ptBR.search.type }) as HTMLSelectElement;
    expect(kept.value).toBe('vantagem');
    expect([...kept.options].at(-1)?.textContent).toBe('vantagem');
  });

  it('reads any key from the address, and leaves out what is no key', () => {
    expect(searchAddressOf({ type: 'talento' }).recordType).toBe('talento');
    expect(searchAddressOf({ type: 't_3d6_tabela' }).recordType).toBe('t_3d6_tabela');
    for (const bad of ['Talento', '3d6', '', 'a-b', 'x'.repeat(33)]) {
      expect(searchAddressOf({ type: bad }).recordType).toBeNull();
    }
    expect(typeOptionsOf([], null)).toEqual(['rule', 'spell', 'item', 'creature', 'character_sheet', 'encounter', 'dungeon', 'note']);
    expect(typeOptionsOf(TYPES, 'talento')).toEqual(['rule', 'spell', 'item', 'talento']);
    expect(typeOptionsOf(TYPES, 'vantagem')).toEqual(['rule', 'spell', 'item', 'talento', 'vantagem']);
  });
});

describe('the "/" key and the search address (Story 3.9)', () => {
  it('focuses the first search field that can be seen, unless a field, an editable text or a dialog has focus', () => {
    document.body.innerHTML = '<input data-search-field="bar" id="bar"><input data-search-field="page" id="page"><button id="b">b</button><dialog open><button id="d">d</button></dialog>';
    const bar = document.getElementById('bar') as HTMLInputElement;
    const key = (init: KeyboardEventInit) => new KeyboardEvent('keydown', { key: '/', ...init });
    (document.getElementById('b') as HTMLButtonElement).focus();
    expect(focusSearchField(key({}), document)).toBe(true);
    expect(document.activeElement).toBe(bar);
    // Hidden by CSS (a phone): the page's own field.
    bar.blur();
    Object.defineProperty(bar, 'checkVisibility', { value: () => false });
    expect(focusSearchField(key({}), document)).toBe(true);
    expect(document.activeElement?.id).toBe('page');
    expect(focusSearchField(key({}), document)).toBe(false);
    (document.getElementById('d') as HTMLButtonElement).focus();
    expect(focusSearchField(key({}), document)).toBe(false);
    (document.getElementById('b') as HTMLButtonElement).focus();
    expect(focusSearchField(key({ ctrlKey: true }), document)).toBe(false);
    expect(focusSearchField(key({ metaKey: true }), document)).toBe(false);
    expect(focusSearchField(new KeyboardEvent('keydown', { key: 'a' }), document)).toBe(false);
    document.body.innerHTML = '';
  });

  it('writes the address in a fixed order, the empty parts and the first page left out', () => {
    expect(searchHref({ query: '' })).toBe('/search');
    expect(searchHref({ query: 'a b&c' })).toBe('/search?q=a+b%26c');
    expect(searchHref({ query: 'x', searchId: SEARCH, tier: 'other', materialId: NOTES, page: 2 })).toBe(
      `/search?q=x&s=${SEARCH}&tier=other&material=${NOTES}&page=2`,
    );
    expect(searchHref({ query: 'x', page: 1 })).toBe('/search?q=x');
  });
});

describe('the source view on the ground of the current scope (Story 3.9)', () => {
  it('reads the page and its picture from the scope relays, its passage marked', async () => {
    const picturePage = { ...PAGE, picture: { width: 100, height: 200 }, lines: [], text: null, passages: [{ id: result(1).passageId, boxes: [[0.1, 0.1, 0.5, 0.2]] }] };
    const loadScope = vi.fn(async () => picturePage);
    render(
      <SourceView
        ground={{ kind: 'scope', campaignId: CAMPAIGN, versionId: VERSION }}
        reference={{ materialName: 'Livro.pdf', sectionPath: [], page: 11, passageIds: [result(1).passageId] }}
        language="pt-BR"
        onClose={() => undefined}
        loadScope={loadScope}
      />,
    );
    const view = screen.getByRole('dialog', { name: 'Livro.pdf' });
    await waitFor(() => expect(view.querySelector('image')).not.toBeNull());
    expect(view.querySelector('image')?.getAttribute('href')).toBe(`/api/v1/campaigns/${CAMPAIGN}/sources/${VERSION}/pages/11/picture`);
    expect(loadScope).toHaveBeenCalledWith(CAMPAIGN, VERSION, 11, expect.any(AbortSignal));
    expect(view.querySelectorAll('[data-cited]').length).toBeGreaterThan(0);
    act(() => undefined);
  });
});
