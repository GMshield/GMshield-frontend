// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let cookieJar: Record<string, string> = {};
vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) => (Object.hasOwn(cookieJar, name) ? { name, value: cookieJar[name] } : undefined),
    set: () => undefined,
  }),
}));
// The pages' client parts ask for the router; outside Next.js there is none.
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ refresh: () => undefined, push: () => undefined, replace: () => undefined, prefetch: () => undefined }),
}));

const { renderToStaticMarkup } = await import('react-dom/server');
const { default: CampaignPage } = await import('@/app/(signed-in)/campaigns/[id]/page');
const { default: NewArtifactPage } = await import('@/app/(signed-in)/campaigns/[id]/artifacts/new/page');
const { default: ArtifactPage } = await import('@/app/(signed-in)/campaigns/[id]/artifacts/[artifactId]/page');
const { default: CharactersPage } = await import('@/app/(signed-in)/characters/page');
const ptBR = (await import('@/messages/pt-BR.json')).default;
const en = (await import('@/messages/en.json')).default;
const { startScripted } = await import('./support/servers');
type Scripted = Awaited<ReturnType<typeof startScripted>>;

const SESSION = 'sessionTokenBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const CREDENTIAL = 'configured-service-credential-0123456789';
const SYSTEM = '0190a0b0-0000-7000-8000-000000000001';
const CAMPAIGN = '0190a0b0-0000-7000-8000-000000000002';
const KAEL = '0190a0b0-0000-7000-8000-000000000901';
const LYRA = '0190a0b0-0000-7000-8000-000000000902';
const SWORD = '0190a0b0-0000-7000-8000-000000000900';
const THURSDAY = { id: CAMPAIGN, name: 'Mesa de quinta', system: { id: SYSTEM, name: 'D&D', edition: null, description: null, version: 0 }, archived: false, version: 0 };
const CORE = ['rule', 'spell', 'item', 'creature', 'character_sheet', 'encounter', 'dungeon', 'note'];
const TYPES = [
  ...CORE.map((core, index) => ({
    id: `0190a0b0-0000-7000-8000-00000000060${index}`,
    name: core,
    core,
    key: core,
    origin: { kind: 'core', proposalId: null, materialId: null, materialName: null },
    records: 0,
    version: 0,
  })),
  {
    id: '0190a0b0-0000-7000-8000-000000000610',
    name: 'Talento',
    core: null,
    key: 'talento',
    origin: { kind: 'proposal', proposalId: '0190a0b0-0000-7000-8000-000000000701', materialId: '0190a0b0-0000-7000-8000-000000000003', materialName: 'Livro do Jogador.pdf' },
    records: 0,
    version: 0,
  },
];
const ROWS = [
  { id: LYRA, recordType: 'character_sheet', name: 'Lyra', version: 1, createdAt: '2026-11-26T12:02:00Z' },
  { id: KAEL, recordType: 'character_sheet', name: 'Kael', version: 1, createdAt: '2026-11-26T12:01:00Z' },
  { id: SWORD, recordType: 'talento', name: 'Conjurador de Guerra', version: 1, createdAt: '2026-11-26T12:00:00Z' },
];
const IN_USE = [
  { key: 'character_sheet', count: 2 },
  { key: 'talento', count: 1 },
];
const ARTIFACT = {
  id: SWORD,
  campaignId: CAMPAIGN,
  recordType: 'item',
  name: 'Espada de Kael',
  fields: [
    { name: 'Dano', value: '1d8 cortante' },
    { name: 'Peso', value: '1,5 kg' },
  ],
  content: 'Forjada nas montanhas do norte.\n<b>Brilha</b> perto de orcs.',
  version: 1,
  currentVersion: 1,
  createdAt: '2026-11-26T12:00:00Z',
  conversationId: null,
  references: [],
};
/** Story 5.2: an artifact's versions as the page reads their first page. */
const VERSIONS_ROUTE = `GET /api/v1/campaigns/${CAMPAIGN}/artifacts/${SWORD}/versions?limit=10`;
const ONE_VERSION = { status: 200, body: { items: [{ number: 1, recordType: 'item', name: 'Espada de Kael', createdAt: '2026-11-26T12:00:00Z' }], total: 1 } };

const ARTIFACTS = `/api/v1/campaigns/${CAMPAIGN}/artifacts`;
const RECORD_TYPES = `GET /api/v1/systems/${SYSTEM}/record-types?limit=50`;
const BASE = {
  [`GET /api/v1/campaigns/${CAMPAIGN}`]: { status: 200, body: THURSDAY },
  'GET /api/v1/campaigns/current': { status: 200, body: THURSDAY },
  [`GET /api/v1/campaigns/${CAMPAIGN}/deletion`]: { status: 200, body: { conversations: 0, materials: 0, artifacts: 3 } },
  [RECORD_TYPES]: { status: 200, body: { items: TYPES, total: TYPES.length } },
};

let backend: Scripted | undefined;
async function useBackend(routes: Parameters<typeof startScripted>[0]): Promise<Scripted> {
  backend = await startScripted(routes);
  vi.stubEnv('GMSHIELD_MODE', '');
  vi.stubEnv('GMSHIELD_BACKEND_URL', backend.url);
  vi.stubEnv('GMSHIELD_FRONTEND_CREDENTIAL', CREDENTIAL);
  return backend;
}

function problem(status: number, code: string) {
  return { status, body: { type: `urn:gmshield:problem:${code}`, title: 'x', status, category: code.split('.')[0], code, params: {}, traceId: 't' } };
}

/** The digest a `redirect()` or `notFound()` call threw, or null when the call returned. */
async function thrownDigest(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (error) {
    const digest = String((error as { digest?: unknown }).digest ?? '');
    if (digest === '') {
      throw error;
    }
    return digest;
  }
}

const params = (id: string) => Promise.resolve({ id });
const query = (values: Record<string, string> = {}) => Promise.resolve(values);
/** The opening tag of the link to `href`, whatever its attributes' order; '' when there is none. */
const linkTo = (html: string, href: string) => [...html.matchAll(/<a\b[^>]*>/g)].map((match) => match[0]).find((tag) => tag.includes(`href="${href}"`)) ?? '';
/** A page without its dialogs (closed until opened, each a surface of its own with its own main action). */
function outsideDialogs(html: string): string {
  let rest = html;
  for (let start = rest.indexOf('<dialog'); start !== -1; start = rest.indexOf('<dialog')) {
    const end = rest.indexOf('</dialog>', start);
    rest = rest.slice(0, start) + (end === -1 ? '' : rest.slice(end + '</dialog>'.length));
  }
  return rest;
}
/** The solid pills of a page, outside its dialogs: links or buttons whose variant is solid. */
const solids = (html: string) => [...outsideDialogs(html).matchAll(/<(a|button)[^>]*data-variant="solid"[^>]*>(.*?)<\/\1>/g)].map((match) => match[2]);
const calls = (server: Scripted) => server.calls.map((call) => `${call.method} ${call.url}`);
const amp = (href: string) => href.replaceAll('&', '&amp;');

beforeEach(() => {
  cookieJar = { '__Host-gmshield-session': `${SESSION}.9999999999` };
});

afterEach(async () => {
  await backend?.close();
  backend = undefined;
  vi.unstubAllEnvs();
});

describe("a campaign's artifacts tab (Story 5.1)", () => {
  it('lists the artifacts newest first, each opening its page with its type, under the type chips and "Novo artefato", in both languages', async () => {
    const server = await useBackend({
      ...BASE,
      [`GET ${ARTIFACTS}?limit=10`]: { status: 200, body: { items: ROWS, total: 3, types: IN_USE } },
    });
    for (const [language, messages] of [['pt-BR', ptBR], ['en', en]] as const) {
      cookieJar['__Host-gmshield-lang'] = language;
      const html = renderToStaticMarkup(await CampaignPage({ params: params(CAMPAIGN), searchParams: query({ tab: 'artifacts' }) }));

      expect(linkTo(html, `/campaigns/${CAMPAIGN}?tab=artifacts`)).toContain('aria-current="page"');
      expect(html).toContain(`>${messages.campaigns.page.artifacts}</a>`);
      // The rows, newest first, each opening the artifact's page, named by its name and its type.
      expect(html.indexOf('Lyra')).toBeLessThan(html.indexOf('Kael'));
      expect(html.indexOf('Kael')).toBeLessThan(html.indexOf('Conjurador de Guerra'));
      expect(linkTo(html, `/campaigns/${CAMPAIGN}/artifacts/${LYRA}`)).not.toBe('');
      expect(html).toContain(messages.systems.recordTypes.character_sheet);
      // An approved type is named by the name its system gives it.
      expect(html).toContain('Talento');
      // The chips: "Todos" current, then each type in use with its count.
      expect(html).toContain(`aria-label="${messages.artifacts.types}"`);
      expect(linkTo(html, `/campaigns/${CAMPAIGN}?tab=artifacts`)).toContain('aria-current');
      expect(linkTo(html, amp(`/campaigns/${CAMPAIGN}?tab=artifacts&type=character_sheet`))).not.toContain('aria-current');
      expect(html).toContain(`${messages.systems.recordTypes.character_sheet} (2)`);
      expect(html).toContain(`aria-label="${messages.artifacts.list}"`);
      // "Exibição" and the pager.
      expect(html).toContain(messages.view.menu);
      expect(linkTo(html, `/campaigns/${CAMPAIGN}/artifacts/new`)).toContain('data-variant="solid"');
      expect(html).not.toMatch(/<[^>]+\sstyle=/);
    }
    expect(calls(server)).toContain(`GET ${ARTIFACTS}?limit=10`);
    expect(calls(server).filter((call) => call.includes('/artifacts'))).toHaveLength(2);
  });

  it('Story 5.6 part B: an artifact shared into the campaign is a row among its own, marked with its campaign in its link, and opens its page here, in both languages', async () => {
    const SHIELD = '0190a0b0-0000-7000-8000-000000000903';
    const FROM = '0190a0b0-0000-7000-8000-000000000040';
    const shared = { id: SHIELD, recordType: 'item', name: 'Escudo de Lyra', version: 1, createdAt: '2026-11-26T12:03:00Z', sharedFrom: { campaignId: FROM, name: 'A Coroa Partida' } };
    await useBackend({
      ...BASE,
      [`GET ${ARTIFACTS}?limit=10`]: {
        status: 200,
        body: { items: [shared, ...ROWS.map((row) => ({ ...row, sharedFrom: null }))], total: 4, types: [...IN_USE, { key: 'item', count: 1 }] },
      },
    });
    for (const [language, messages] of [['pt-BR', ptBR], ['en', en]] as const) {
      cookieJar['__Host-gmshield-lang'] = language;
      const html = renderToStaticMarkup(await CampaignPage({ params: params(CAMPAIGN), searchParams: query({ tab: 'artifacts' }) }));
      const mark = messages.artifacts.share.listedFrom.replace('{campaign}', 'A Coroa Partida');
      // The row opens the artifact's page under this campaign (part A's read-only page), and its link holds the mark.
      const link = html.slice(html.indexOf(`href="/campaigns/${CAMPAIGN}/artifacts/${SHIELD}"`));
      expect(link.slice(0, link.indexOf('</a>'))).toContain(`${messages.systems.recordTypes.item} · ${mark}`);
      expect(html.indexOf('Escudo de Lyra')).toBeLessThan(html.indexOf('Lyra<'));
      // An own row has no mark.
      const own = html.slice(html.indexOf(`href="/campaigns/${CAMPAIGN}/artifacts/${LYRA}"`));
      expect(own.slice(0, own.indexOf('</a>'))).not.toContain(mark);
      // Once in the list (Story 5.7 part B: the export dialog lists the rows too).
      expect(outsideDialogs(html).split(mark)).toHaveLength(2);
    }
    expect(ptBR.artifacts.share.listedFrom).toBe('Compartilhado de {campaign}');
  });

  it('a chip narrows the list to its type, and the page links keep it', async () => {
    const server = await useBackend({
      ...BASE,
      [`GET ${ARTIFACTS}?limit=10&offset=10&recordType=character_sheet`]: {
        status: 200,
        body: { items: [ROWS[1]], total: 31, types: IN_USE },
      },
    });

    const html = renderToStaticMarkup(
      await CampaignPage({ params: params(CAMPAIGN), searchParams: query({ tab: 'artifacts', type: 'character_sheet', page: '2' }) }),
    );

    expect(calls(server)).toContain(`GET ${ARTIFACTS}?limit=10&offset=10&recordType=character_sheet`);
    expect(linkTo(html, amp(`/campaigns/${CAMPAIGN}?tab=artifacts&type=character_sheet`))).toContain('aria-current');
    expect(html).toContain('Kael');
    expect(html).not.toContain('Lyra');
    // "Novo artefato" starts with the chosen type.
    expect(linkTo(html, `/campaigns/${CAMPAIGN}/artifacts/new?type=character_sheet`)).toContain('data-variant="solid"');
    // The pager's links keep the tab and the type: page 2 is the current one, page 3 is a link of its own.
    expect(linkTo(html, amp(`/campaigns/${CAMPAIGN}?tab=artifacts&type=character_sheet&page=2`))).toContain('aria-current="page"');
    expect(linkTo(html, amp(`/campaigns/${CAMPAIGN}?tab=artifacts&type=character_sheet&page=3`))).not.toBe('');
  });

  it('an empty campaign says so in one sentence with "Novo artefato"; a type with none leads back to all', async () => {
    await useBackend({
      ...BASE,
      [`GET ${ARTIFACTS}?limit=10`]: { status: 200, body: { items: [], total: 0, types: [] } },
      [`GET ${ARTIFACTS}?limit=10&recordType=spell`]: { status: 200, body: { items: [], total: 0, types: IN_USE } },
    });

    let html = renderToStaticMarkup(await CampaignPage({ params: params(CAMPAIGN), searchParams: query({ tab: 'artifacts' }) }));
    expect(html).toContain(ptBR.artifacts.empty);
    expect(solids(html)).toContain(ptBR.artifacts.new);
    expect(html).not.toContain(`aria-label="${ptBR.artifacts.types}"`);

    html = renderToStaticMarkup(await CampaignPage({ params: params(CAMPAIGN), searchParams: query({ tab: 'artifacts', type: 'spell' }) }));
    expect(html).toContain(ptBR.view.emptyFilter);
    expect(html).toContain(`>${ptBR.view.clearFilter}</a>`);
    expect(html).toContain(`aria-label="${ptBR.artifacts.types}"`);
  });

  it('loads nothing of the artifacts on another tab, and a list that cannot be read says why', async () => {
    const server = await useBackend({ ...BASE, [`GET ${ARTIFACTS}?limit=10`]: problem(503, 'server.unavailable') });

    renderToStaticMarkup(await CampaignPage({ params: params(CAMPAIGN), searchParams: query() }));
    expect(calls(server).filter((call) => call.includes('/artifacts') || call.includes('/record-types'))).toEqual([]);

    const html = renderToStaticMarkup(await CampaignPage({ params: params(CAMPAIGN), searchParams: query({ tab: 'artifacts' }) }));
    expect(html).toContain('O serviço está indisponível agora. Tente de novo em instantes.');
  });
});

/** The labels of the checkboxes in the page's export dialog (Story 5.7 part B), in order; [] when there is none. */
function exportRows(html: string, messages: typeof ptBR = ptBR): string[] {
  const title = `>${messages.artifacts.export.title}</h2>`;
  for (let start = html.indexOf('<dialog'); start !== -1; start = html.indexOf('<dialog', start + 1)) {
    const dialog = html.slice(start, html.indexOf('</dialog>', start));
    if (dialog.includes(title)) {
      return [...dialog.matchAll(/<input type="checkbox"[^>]*aria-label="([^"]*)"/g)].map((match) => match[1] ?? '');
    }
  }
  return [];
}
/** The export pill that opens the dialog (Story 5.7 part B), or '' when there is none. */
const exportOpener = (html: string, messages: typeof ptBR) =>
  new RegExp(`<button[^>]*aria-haspopup="dialog"[^>]*>${messages.artifacts.export.action}</button>`).exec(outsideDialogs(html))?.[0] ?? '';

describe('"Exportar" above the lists (Story 5.7 part B)', () => {
  it('the tab has "Exportar" beside "Novo artefato", its dialog offering the page\'s rows in list order, shared ones too, in both languages', async () => {
    const SHIELD = '0190a0b0-0000-7000-8000-000000000903';
    const shared = { id: SHIELD, recordType: 'item', name: 'Escudo de Lyra', version: 1, createdAt: '2026-11-26T12:03:00Z', sharedFrom: { campaignId: '0190a0b0-0000-7000-8000-000000000040', name: 'A Coroa Partida' } };
    await useBackend({
      ...BASE,
      [`GET ${ARTIFACTS}?limit=10`]: { status: 200, body: { items: [shared, ...ROWS], total: 4, types: [...IN_USE, { key: 'item', count: 1 }] } },
    });
    for (const [language, messages] of [['pt-BR', ptBR], ['en', en]] as const) {
      cookieJar['__Host-gmshield-lang'] = language;
      const html = renderToStaticMarkup(await CampaignPage({ params: params(CAMPAIGN), searchParams: query({ tab: 'artifacts' }) }));
      const pill = exportOpener(html, messages);
      expect(pill).not.toBe('');
      // Beside "Novo artefato", before the list.
      const create = html.indexOf(linkTo(html, `/campaigns/${CAMPAIGN}/artifacts/new`));
      expect(create).toBeGreaterThan(-1);
      expect(html.indexOf(pill)).toBeGreaterThan(create);
      expect(html.indexOf(pill)).toBeLessThan(html.indexOf(`aria-label="${messages.artifacts.list}"`));
      expect(html).toContain(`>${messages.artifacts.export.title}</h2>`);
      const sheet = messages.systems.recordTypes.character_sheet;
      expect(exportRows(html, messages)).toEqual([
        `Escudo de Lyra, ${messages.systems.recordTypes.item} · ${messages.artifacts.share.listedFrom.replace('{campaign}', 'A Coroa Partida')}`,
        `Lyra, ${sheet}`,
        `Kael, ${sheet}`,
        'Conjurador de Guerra, Talento',
      ]);
      // Nothing ticked when it opens.
      expect(html).not.toMatch(/<input type="checkbox"[^>]*checked=""/);
    }
  });

  it('with a type chosen, the dialog offers that page\'s rows only; neither an empty campaign nor a type with none has "Exportar"', async () => {
    await useBackend({
      ...BASE,
      [`GET ${ARTIFACTS}?limit=10&offset=10&recordType=character_sheet`]: { status: 200, body: { items: [ROWS[1]], total: 11, types: IN_USE } },
      [`GET ${ARTIFACTS}?limit=10&recordType=spell`]: { status: 200, body: { items: [], total: 0, types: IN_USE } },
    });
    let html = renderToStaticMarkup(
      await CampaignPage({ params: params(CAMPAIGN), searchParams: query({ tab: 'artifacts', type: 'character_sheet', page: '2' }) }),
    );
    expect(exportRows(html)).toEqual([`Kael, ${ptBR.systems.recordTypes.character_sheet}`]);

    html = renderToStaticMarkup(await CampaignPage({ params: params(CAMPAIGN), searchParams: query({ tab: 'artifacts', type: 'spell' }) }));
    expect(html).toContain(ptBR.view.emptyFilter);
    expect(exportOpener(html, ptBR)).toBe('');
    expect(html).not.toContain(`>${ptBR.artifacts.export.title}</h2>`);
    await backend?.close();

    await useBackend({ ...BASE, [`GET ${ARTIFACTS}?limit=10`]: { status: 200, body: { items: [], total: 0, types: [] } } });
    html = renderToStaticMarkup(await CampaignPage({ params: params(CAMPAIGN), searchParams: query({ tab: 'artifacts' }) }));
    expect(html).toContain(ptBR.artifacts.empty);
    expect(html).not.toContain(`>${ptBR.artifacts.export.action}<`);
  });

  it('"Personagens" has "Exportar" beside "Nova ficha", offering the page\'s sheets; an empty list has none', async () => {
    const SHEET = '0190a0b0-0000-7000-8000-000000000903';
    const shared = { id: SHEET, recordType: 'character_sheet', name: 'Thorin', version: 1, createdAt: '2026-11-26T12:03:00Z', sharedFrom: { campaignId: '0190a0b0-0000-7000-8000-000000000040', name: 'A Coroa Partida' } };
    await useBackend({
      ...BASE,
      [`GET ${ARTIFACTS}?limit=10&recordType=character_sheet`]: { status: 200, body: { items: [shared, ...ROWS.slice(0, 2)], total: 3, types: IN_USE } },
    });
    for (const [language, messages] of [['pt-BR', ptBR], ['en', en]] as const) {
      cookieJar['__Host-gmshield-lang'] = language;
      const html = renderToStaticMarkup(await CharactersPage({ searchParams: query() }));
      const header = outsideDialogs(html.slice(html.indexOf('<header'), html.indexOf('</header>')));
      const pill = exportOpener(header, messages);
      expect(pill).not.toBe('');
      expect(header.indexOf(pill)).toBeGreaterThan(header.indexOf(`>${messages.characters.new}<`));
      // No type in "Personagens": a shared sheet's detail is its mark, an own sheet is named alone.
      expect(exportRows(html, messages)).toEqual([`Thorin, ${messages.artifacts.share.listedFrom.replace('{campaign}', 'A Coroa Partida')}`, 'Lyra', 'Kael']);
    }
    await backend?.close();

    await useBackend({
      ...BASE,
      [`GET ${ARTIFACTS}?limit=10&recordType=character_sheet`]: { status: 200, body: { items: [], total: 0, types: [] } },
    });
    cookieJar['__Host-gmshield-lang'] = 'pt-BR';
    const html = renderToStaticMarkup(await CharactersPage({ searchParams: query() }));
    expect(html).toContain(ptBR.characters.empty);
    expect(html).not.toContain(`>${ptBR.artifacts.export.action}<`);
  });
});

describe("a new artifact's form (Story 5.1)", () => {
  it('leads back to the artifacts tab, offers the system\'s record types by this interface\'s names, and starts with ?type= or a note', async () => {
    await useBackend(BASE);
    for (const [language, messages] of [['pt-BR', ptBR], ['en', en]] as const) {
      cookieJar['__Host-gmshield-lang'] = language;
      const html = renderToStaticMarkup(await NewArtifactPage({ params: params(CAMPAIGN), searchParams: query() }));

      expect(html).toMatch(new RegExp(`<h1[^>]*>${messages.artifacts.form.title}</h1>`));
      expect(linkTo(html, `/campaigns/${CAMPAIGN}?tab=artifacts`)).not.toBe('');
      // The same way back as an artifact's page: "Artefatos".
      expect(html).toContain(`>${messages.campaigns.page.artifacts}</a>`);
      expect(html).not.toContain('name="from"');
      expect(html).toContain(`>${messages.systems.recordTypes.character_sheet}</option>`);
      expect(html).toContain('>Talento</option>');
      expect(html).toMatch(/<option value="note" selected="">/);
      expect(html).toContain(`>${messages.artifacts.form.content}</label>`);
      expect(html).toMatch(/<textarea[^>]*name="content"/);
      expect(solids(html)).toEqual([messages.artifacts.form.save]);
      expect(html).toContain(`name="campaignId" value="${CAMPAIGN}"`);
      expect(html).not.toMatch(/<[^>]+\sstyle=/);
    }
    cookieJar['__Host-gmshield-lang'] = 'pt-BR';
    const sheet = renderToStaticMarkup(await NewArtifactPage({ params: params(CAMPAIGN), searchParams: query({ type: 'character_sheet' }) }));
    expect(sheet).toMatch(/<option value="character_sheet" selected="">/);
    const unknown = renderToStaticMarkup(await NewArtifactPage({ params: params(CAMPAIGN), searchParams: query({ type: 'weapon' }) }));
    expect(unknown).toMatch(/<option value="note" selected="">/);
    // Opened from "Personagens" ("Nova ficha"): the way back and "Cancelar" lead there, and the form posts where from.
    const fromCharacters = renderToStaticMarkup(
      await NewArtifactPage({ params: params(CAMPAIGN), searchParams: query({ type: 'character_sheet', from: 'characters' }) }),
    );
    expect([...fromCharacters.matchAll(/<a\b[^>]*href="\/characters"[^>]*>([^<]*)</g)].map((match) => match[1])).toEqual(
      expect.arrayContaining([ptBR.artifacts.form.cancel]),
    );
    expect(fromCharacters).toContain(`>${ptBR.shell.entries.characters}</a>`);
    expect(fromCharacters).toContain('name="from" value="characters"');
    // Anything else is the artifacts tab, and nothing is posted.
    const elsewhere = renderToStaticMarkup(await NewArtifactPage({ params: params(CAMPAIGN), searchParams: query({ from: '/evil' }) }));
    expect(elsewhere).not.toContain('href="/characters"');
    expect(elsewhere).not.toContain('name="from"');
  });

  it("another owner's campaign is the single not-found page", async () => {
    await useBackend({ [`GET /api/v1/campaigns/${CAMPAIGN}`]: problem(404, 'request.not_found') });
    expect(await thrownDigest(() => NewArtifactPage({ params: params(CAMPAIGN), searchParams: query() }))).toMatch(/^NEXT_HTTP_ERROR_FALLBACK;404/);
  });

});

describe("an artifact's page (Story 5.1)", () => {
  it('shows the name, the type as the subtitle, the fields as a two-column list, the content as Markdown with its lines and no sources', async () => {
    await useBackend({ ...BASE, [`GET ${ARTIFACTS}/${SWORD}`]: { status: 200, body: ARTIFACT }, [VERSIONS_ROUTE]: ONE_VERSION });
    for (const [language, messages] of [['pt-BR', ptBR], ['en', en]] as const) {
      cookieJar['__Host-gmshield-lang'] = language;
      const html = renderToStaticMarkup(await ArtifactPage({ params: Promise.resolve({ id: CAMPAIGN, artifactId: SWORD }) }));

      expect(html).toMatch(/<h1[^>]*>Espada de Kael<\/h1>/);
      expect(linkTo(html, `/campaigns/${CAMPAIGN}?tab=artifacts`)).not.toBe('');
      expect(html).toContain(`>${messages.campaigns.page.artifacts}<`);
      expect(html).toContain(messages.systems.recordTypes.item);
      expect(html).toMatch(/<dt>Dano<\/dt><dd>1d8 cortante<\/dd>/);
      expect(html.indexOf('Peso')).toBeGreaterThan(html.indexOf('Dano'));
      expect(html).toContain(`>${messages.artifacts.page.content}</h2>`);
      // Story 5.4 part A: sanitized Markdown (raw HTML skipped, never rendered), its single line break kept.
      expect(html).toMatch(/<p>Forjada nas montanhas do norte\.<br\/>\s*Brilha perto de orcs\.<\/p>/);
      expect(html).not.toContain('<b>');
      // Written by hand: no conversation to open.
      expect(html).not.toContain(messages.artifacts.page.conversation);
      expect(html).toContain(`>${messages.artifacts.page.sources}</h2>`);
      expect(html).toContain(messages.artifacts.page.noSources);
      expect(html.indexOf(messages.artifacts.page.content)).toBeLessThan(html.indexOf(messages.artifacts.page.noSources));
      expect(html).not.toMatch(/<[^>]+\sstyle=/);
    }
    // Opened from "Personagens", its way back leads there.
    cookieJar['__Host-gmshield-lang'] = 'pt-BR';
    const fromCharacters = renderToStaticMarkup(
      await ArtifactPage({ params: Promise.resolve({ id: CAMPAIGN, artifactId: SWORD }), searchParams: query({ from: 'characters' }) }),
    );
    expect(linkTo(fromCharacters, '/characters')).not.toBe('');
    expect(fromCharacters).toContain(`>${ptBR.shell.entries.characters}</a>`);
    expect(linkTo(fromCharacters, `/campaigns/${CAMPAIGN}?tab=artifacts`)).toBe('');
  });

  it('Story 5.4 part A: a saved draft renders its Markdown, lists its sources (a removed one unlinked) and opens its conversation', async () => {
    const conversation = '0190a0b0-0000-7000-8000-000000000020';
    const saved = {
      ...ARTIFACT,
      recordType: 'encounter',
      name: 'Emboscada na Cripta',
      fields: [],
      content: '## Cripta\n\n- Três esqueletos\n- Um carniçal\n\n```\nlinha um\nlinha dois\n```',
      conversationId: conversation,
      references: [
        { number: 1, kind: 'passage', materialName: 'Notas da campanha.md', sectionPath: ['Cripta'], page: 2, passageIds: ['0190a0b0-0000-7000-8000-000000000010'], removed: false, tier: 'campaign' },
        { number: 2, kind: 'passage', materialName: 'Livro apagado.pdf', sectionPath: [], page: 9, passageIds: ['0190a0b0-0000-7000-8000-000000000011'], removed: true, tier: 'system' },
        { number: 3, kind: 'artifact', artifactId: KAEL, artifactVersion: 1, recordType: 'character_sheet', name: 'Kael', fields: [], removed: false, tier: 'campaign' },
      ],
    };
    await useBackend({ ...BASE, [`GET ${ARTIFACTS}/${SWORD}`]: { status: 200, body: saved }, [VERSIONS_ROUTE]: ONE_VERSION });
    const html = renderToStaticMarkup(await ArtifactPage({ params: Promise.resolve({ id: CAMPAIGN, artifactId: SWORD }) }));

    expect(html).toMatch(/<h2>Cripta<\/h2>/);
    expect(html).toMatch(/<li>Três esqueletos<\/li>/);
    // A fenced block keeps its lines as written, with no break added inside it.
    expect(html).toContain('linha um\nlinha dois');
    expect(html).not.toContain('linha um<br');
    // "Fontes": each reference, numbered; the removed one struck through, with "fonte removida" and no link.
    expect(html).toContain(`aria-label="${ptBR.conversation.references}"`);
    expect(html).toContain('Notas da campanha.md, Cripta, p. 2');
    expect(html).toMatch(/<s[^>]*>Livro apagado\.pdf, p\. 9<\/s> — fonte removida/);
    expect(linkTo(html, `/campaigns/${CAMPAIGN}/artifacts/${KAEL}?version=1`)).not.toBe('');
    expect(html).not.toContain(ptBR.artifacts.page.noSources);
    // The conversation it came from.
    expect(linkTo(html, `/questions/${conversation}`)).not.toBe('');
    expect(html).toContain(ptBR.artifacts.page.conversation);
  });

  it('Story 5.4 part B: a saved draft kept when its conversation was deleted keeps its sources and opens no conversation', async () => {
    const kept = {
      ...ARTIFACT,
      recordType: 'encounter',
      name: 'Emboscada na Cripta',
      fields: [],
      content: '## Cripta',
      // The backend names no conversation from the moment its deletion starts.
      conversationId: null,
      references: [
        { number: 1, kind: 'passage', materialName: 'Notas da campanha.md', sectionPath: ['Cripta'], page: 2, passageIds: ['0190a0b0-0000-7000-8000-000000000010'], removed: false, tier: 'campaign' },
      ],
    };
    await useBackend({ ...BASE, [`GET ${ARTIFACTS}/${SWORD}`]: { status: 200, body: kept }, [VERSIONS_ROUTE]: ONE_VERSION });
    const html = renderToStaticMarkup(await ArtifactPage({ params: Promise.resolve({ id: CAMPAIGN, artifactId: SWORD }) }));

    expect(html).toContain('Notas da campanha.md, Cripta, p. 2');
    expect(html).not.toContain(ptBR.artifacts.page.conversation);
    expect(html).not.toMatch(/href="\/questions\//);
  });

  it('an artifact without fields or content shows neither; another owner\'s or another campaign\'s is not found', async () => {
    await useBackend({
      ...BASE,
      [`GET ${ARTIFACTS}/${SWORD}`]: { status: 200, body: { ...ARTIFACT, fields: [], content: null } },
      [`GET ${ARTIFACTS}/${KAEL}`]: problem(404, 'request.not_found'),
      [VERSIONS_ROUTE]: ONE_VERSION,
    });
    const html = renderToStaticMarkup(await ArtifactPage({ params: Promise.resolve({ id: CAMPAIGN, artifactId: SWORD }) }));
    expect(html).not.toContain('<dl');
    expect(html).not.toContain(`>${ptBR.artifacts.page.content}</h2>`);
    expect(html).toContain(ptBR.artifacts.page.noSources);

    expect(await thrownDigest(() => ArtifactPage({ params: Promise.resolve({ id: CAMPAIGN, artifactId: KAEL }) }))).toMatch(
      /^NEXT_HTTP_ERROR_FALLBACK;404/,
    );
  });
});

describe("an artifact's override (Story 5.5 part A)", () => {
  const RECORD = '0190a0b0-0000-7000-8000-000000000700';
  const MARK = { recordId: RECORD, name: 'Bola de Fogo', recordType: 'spell', systemId: SYSTEM, removed: false };
  const sections = (html: string, messages: typeof ptBR) => ({
    override: html.indexOf(`>${messages.artifacts.override.title}</h2>`),
    sources: html.indexOf(`>${messages.artifacts.page.sources}</h2>`),
    content: html.indexOf(`>${messages.artifacts.page.content}</h2>`),
  });

  it('"Substituição" sits between the fields and "Fontes": none, with "Substituir um registro", in both languages', async () => {
    await useBackend({ ...BASE, [`GET ${ARTIFACTS}/${SWORD}`]: { status: 200, body: { ...ARTIFACT, overrides: null } }, [VERSIONS_ROUTE]: ONE_VERSION });
    for (const [language, messages] of [['pt-BR', ptBR], ['en', en]] as const) {
      cookieJar['__Host-gmshield-lang'] = language;
      const html = renderToStaticMarkup(await ArtifactPage({ params: Promise.resolve({ id: CAMPAIGN, artifactId: SWORD }) }));

      const at = sections(html, messages);
      expect(at.content).toBeGreaterThan(-1);
      expect(at.override).toBeGreaterThan(at.content);
      expect(at.sources).toBeGreaterThan(at.override);
      expect(html).toContain(messages.artifacts.override.none);
      expect(html).toMatch(new RegExp(`<button[^>]*aria-haspopup="dialog"[^>]*>${messages.artifacts.override.open}</button>`));
      expect(html).not.toContain(messages.artifacts.override.remove);
      // The picker is mounted only once it is opened.
      expect(html).not.toContain(messages.artifacts.override.dialogIntro);
    }
  });

  it('a mark names the record as a link to its page, with its type and "Remover substituição"; one with no effect says so, unlinked', async () => {
    await useBackend({ ...BASE, [`GET ${ARTIFACTS}/${SWORD}`]: { status: 200, body: { ...ARTIFACT, overrides: MARK } }, [VERSIONS_ROUTE]: ONE_VERSION });
    const html = renderToStaticMarkup(await ArtifactPage({ params: Promise.resolve({ id: CAMPAIGN, artifactId: SWORD }) }));

    expect(html).toContain(ptBR.artifacts.override.replaces);
    expect(linkTo(html, `/search/records/${RECORD}`)).not.toBe('');
    expect(html).toMatch(/>Bola de Fogo<\/a><span[^>]*> · Magia<\/span>/);
    expect(html).toContain(`>${ptBR.artifacts.override.remove}</button>`);
    expect(html).not.toContain(ptBR.artifacts.override.none);
    expect(html).not.toContain(ptBR.artifacts.override.removed);

    await backend?.close();
    await useBackend({
      ...BASE,
      [`GET ${ARTIFACTS}/${SWORD}`]: { status: 200, body: { ...ARTIFACT, overrides: { ...MARK, removed: true } } },
      [VERSIONS_ROUTE]: ONE_VERSION,
    });
    const gone = renderToStaticMarkup(await ArtifactPage({ params: Promise.resolve({ id: CAMPAIGN, artifactId: SWORD }) }));
    expect(gone).toContain(ptBR.artifacts.override.removed);
    expect(linkTo(gone, `/search/records/${RECORD}`)).toBe('');
    expect(gone).toContain('Bola de Fogo');
    expect(gone).toContain(`>${ptBR.artifacts.override.remove}</button>`);
  });
});

describe("an artifact's relations (Story 5.5 part B)", () => {
  const TROLL = '0190a0b0-0000-7000-8000-000000000700';
  const MAP = '0190a0b0-0000-7000-8000-000000000902';
  const GONE = '0190a0b0-0000-7000-8000-000000000701';
  const RELATED = [
    { recordId: TROLL, name: 'Troll', recordType: 'creature', tier: 'system', artifact: false, removed: false },
    { recordId: MAP, name: 'Mapa', recordType: 'note', tier: 'campaign', artifact: true, removed: false },
    { recordId: GONE, name: 'Lobo', recordType: 'creature', tier: null, artifact: false, removed: true },
  ];
  const heading = (html: string, text: string) => html.indexOf(`>${text}</h2>`);

  it('"Relacionados" sits after "Substituição" and before "Fontes": none, with "Relacionar um registro", in both languages', async () => {
    await useBackend({ ...BASE, [`GET ${ARTIFACTS}/${SWORD}`]: { status: 200, body: { ...ARTIFACT, overrides: null, related: [] } }, [VERSIONS_ROUTE]: ONE_VERSION });
    for (const [language, messages] of [['pt-BR', ptBR], ['en', en]] as const) {
      cookieJar['__Host-gmshield-lang'] = language;
      const html = renderToStaticMarkup(await ArtifactPage({ params: Promise.resolve({ id: CAMPAIGN, artifactId: SWORD }) }));

      const related = heading(html, messages.artifacts.relations.title);
      expect(related).toBeGreaterThan(heading(html, messages.artifacts.override.title));
      expect(heading(html, messages.artifacts.page.sources)).toBeGreaterThan(related);
      expect(html).toContain(messages.artifacts.relations.none);
      expect(html).toMatch(new RegExp(`<button[^>]*aria-haspopup="dialog"[^>]*>${messages.artifacts.relations.open}</button>`));
      // The picker is mounted only once it is opened.
      expect(html).not.toContain(messages.artifacts.relations.dialogIntro);
    }
  });

  it('each relation links to its page (an artifact\'s, or the campaign record page) with its type and tier; a removed one is unlinked', async () => {
    await useBackend({ ...BASE, [`GET ${ARTIFACTS}/${SWORD}`]: { status: 200, body: { ...ARTIFACT, overrides: null, related: RELATED } }, [VERSIONS_ROUTE]: ONE_VERSION });
    const html = renderToStaticMarkup(await ArtifactPage({ params: Promise.resolve({ id: CAMPAIGN, artifactId: SWORD }) }));

    expect(html).not.toContain(ptBR.artifacts.relations.none);
    expect(linkTo(html, `/search/records/${TROLL}`)).not.toBe('');
    expect(linkTo(html, `/campaigns/${CAMPAIGN}/artifacts/${MAP}`)).not.toBe('');
    expect(linkTo(html, `/search/records/${GONE}`)).toBe('');
    expect(html).toMatch(/>Sistema<\/span>.*?>Troll<\/a><span[^>]*> · Criatura<\/span>/);
    expect(html).toMatch(/>Campanha<\/span>.*?>Mapa<\/a><span[^>]*> · Nota<\/span>/);
    expect(html).toContain(`> · ${ptBR.artifacts.relations.removed}</span>`);
    for (const name of ['Troll', 'Mapa', 'Lobo']) {
      expect(html).toContain(`aria-label="Remover a relação com ${name}"`);
    }
  });

  it('a backend before contract 1.51.0 (no related) shows none', async () => {
    // The fixture has no `related`, as such a backend answers.
    expect(Object.hasOwn(ARTIFACT, 'related')).toBe(false);
    await useBackend({ ...BASE, [`GET ${ARTIFACTS}/${SWORD}`]: { status: 200, body: ARTIFACT }, [VERSIONS_ROUTE]: ONE_VERSION });
    const html = renderToStaticMarkup(await ArtifactPage({ params: Promise.resolve({ id: CAMPAIGN, artifactId: SWORD }) }));
    expect(html).toContain(ptBR.artifacts.relations.none);
  });
});

describe("an artifact's sharing (Story 5.6 part A)", () => {
  const SUNDAY = '0190a0b0-0000-7000-8000-000000000042';
  const FRIDAY = '0190a0b0-0000-7000-8000-000000000044';
  const OLD = '0190a0b0-0000-7000-8000-000000000043';
  const CROWN = '0190a0b0-0000-7000-8000-000000000045';
  const row = (id: string, name: string) => ({ id, name, system: { id: SYSTEM, name: 'D&D', edition: null }, archived: false });
  /** The system's campaigns in use, newest first, as the backend lists them: the artifact's own among them. */
  const IN_USE = `GET /api/v1/campaigns?system=${SYSTEM}&limit=50`;
  const CAMPAIGNS = { status: 200, body: { items: [row(SUNDAY, 'Mesa de domingo'), row(CAMPAIGN, 'Mesa de quinta'), row(FRIDAY, 'Mesa de sexta')], total: 3 } };
  const SHARED = {
    ...ARTIFACT,
    overrides: null,
    related: [],
    sharedWith: [
      { campaignId: OLD, name: 'Mesa antiga', archived: true },
      { campaignId: FRIDAY, name: 'Mesa de sexta', archived: false },
    ],
    sharedFrom: null,
  };
  const heading = (html: string, text: string) => html.indexOf(`>${text}</h2>`);
  const boxes = (html: string) => [...html.matchAll(/<input[^>]*type="checkbox"[^>]*>/g)].map((match) => match[0]);

  it('"Compartilhamento" sits after "Relacionados" and before "Fontes": the other campaigns by name, then the archived ones shared', async () => {
    const server = await useBackend({ ...BASE, [`GET ${ARTIFACTS}/${SWORD}`]: { status: 200, body: SHARED }, [VERSIONS_ROUTE]: ONE_VERSION, [IN_USE]: CAMPAIGNS });
    for (const [language, messages] of [['pt-BR', ptBR], ['en', en]] as const) {
      cookieJar['__Host-gmshield-lang'] = language;
      const html = renderToStaticMarkup(await ArtifactPage({ params: Promise.resolve({ id: CAMPAIGN, artifactId: SWORD }) }));

      const sharing = heading(html, messages.artifacts.share.title);
      expect(sharing).toBeGreaterThan(heading(html, messages.artifacts.relations.title));
      expect(heading(html, messages.artifacts.page.sources)).toBeGreaterThan(sharing);
      expect(html).toContain(messages.artifacts.share.intro);
      // Its own campaign is no row; the others in use by name, then the archived one it is shared with, marked.
      const rows = boxes(html);
      expect(rows.map((box) => /value="([^"]+)"/.exec(box)?.[1])).toEqual([SUNDAY, FRIDAY, OLD]);
      expect(rows.map((box) => box.includes('checked'))).toEqual([false, true, true]);
      // In the section (Story 5.6 part B: the header's delete dialog names the shared ones too).
      const section = html.slice(sharing);
      expect(section.indexOf('Mesa de domingo')).toBeLessThan(section.indexOf('Mesa de sexta'));
      expect(html).toContain(`>${messages.artifacts.share.archived}</span>`);
      expect(html).toMatch(new RegExp(`<button[^>]*>${messages.artifacts.share.save}</button>`));
      expect(html).not.toMatch(/<[^>]+\sstyle=/);
    }
    expect(calls(server)).toContain(IN_USE);
  });

  it('on an earlier version too; with no other campaign, one sentence and "Nova campanha" on the system', async () => {
    await useBackend({
      ...BASE,
      [`GET ${ARTIFACTS}/${SWORD}/versions/1`]: { status: 200, body: { ...SHARED, sharedWith: [], version: 1, currentVersion: 2 } },
      [`GET ${ARTIFACTS}/${SWORD}`]: { status: 200, body: { ...SHARED, sharedWith: [], version: 2, currentVersion: 2 } },
      [VERSIONS_ROUTE]: ONE_VERSION,
      [IN_USE]: { status: 200, body: { items: [row(CAMPAIGN, 'Mesa de quinta')], total: 1 } },
    });
    const html = renderToStaticMarkup(
      await ArtifactPage({ params: Promise.resolve({ id: CAMPAIGN, artifactId: SWORD }), searchParams: query({ version: '1' }) }),
    );
    expect(html).toContain(`>${ptBR.artifacts.share.title}</h2>`);
    expect(html).toContain(ptBR.artifacts.share.none);
    expect(linkTo(html, amp(`/campaigns/new?system=${SYSTEM}`))).not.toBe('');
    expect(boxes(html)).toEqual([]);
    expect(html).not.toMatch(new RegExp(`<button[^>]*>${ptBR.artifacts.share.save}</button>`));
  });

  it('a backend before contract 1.52.0 (no sharedWith, no sharedFrom) shows the section with nothing ticked', async () => {
    expect(Object.hasOwn(ARTIFACT, 'sharedWith')).toBe(false);
    await useBackend({ ...BASE, [`GET ${ARTIFACTS}/${SWORD}`]: { status: 200, body: ARTIFACT }, [VERSIONS_ROUTE]: ONE_VERSION, [IN_USE]: CAMPAIGNS });
    const html = renderToStaticMarkup(await ArtifactPage({ params: Promise.resolve({ id: CAMPAIGN, artifactId: SWORD }) }));
    expect(boxes(html)).toHaveLength(2);
    expect(boxes(html).some((box) => box.includes('checked'))).toBe(false);
    // The rest of the page as before: the editor, "Excluir" and "Versões".
    expect(html).toMatch(new RegExp(`<button[^>]*>${ptBR.artifacts.edit.open}</button>`));
    expect(html).toContain(`>${ptBR.artifacts.versions.title}</h2>`);
  });

  it('shared into this campaign, it reads read-only: its name, type, fields, content and "Fontes", naming the campaign it is shared from', async () => {
    const IN_B = `/api/v1/campaigns/${CAMPAIGN}/artifacts/${SWORD}`;
    const FROM = { ...ARTIFACT, campaignId: CROWN, overrides: null, related: [], sharedWith: [], sharedFrom: { campaignId: CROWN, name: 'A Coroa Partida' } };
    const server = await useBackend({ ...BASE, [`GET ${IN_B}`]: { status: 200, body: FROM } });
    for (const [language, messages] of [['pt-BR', ptBR], ['en', en]] as const) {
      cookieJar['__Host-gmshield-lang'] = language;
      const html = renderToStaticMarkup(await ArtifactPage({ params: Promise.resolve({ id: CAMPAIGN, artifactId: SWORD }) }));

      expect(html).toMatch(/<h1[^>]*>Espada de Kael<\/h1>/);
      expect(html).toContain(messages.systems.recordTypes.item);
      expect(html).toContain('1d8 cortante');
      expect(html).toContain('Forjada nas montanhas do norte.');
      expect(html).toContain(`>${messages.artifacts.page.sources}</h2>`);
      expect(html).toContain(messages.artifacts.share.sharedFrom.replace('{campaign}', 'A Coroa Partida'));
      const own = linkTo(html, `/campaigns/${CROWN}/artifacts/${SWORD}`);
      expect(own).not.toBe('');
      expect(html).toContain(`>${messages.artifacts.share.openIn.replace('{campaign}', 'A Coroa Partida')}</a>`);
      // The way back stays in this campaign.
      expect(linkTo(html, `/campaigns/${CAMPAIGN}?tab=artifacts`)).not.toBe('');
      // Nothing that changes it: no editor, "Excluir", "Versões", override, relations or sharing.
      expect(html).not.toMatch(new RegExp(`<button[^>]*>${messages.artifacts.edit.open}</button>`));
      expect(html).not.toContain(`>${messages.artifacts.delete.action}<`);
      for (const title of [messages.artifacts.versions.title, messages.artifacts.override.title, messages.artifacts.relations.title, messages.artifacts.share.title]) {
        expect(html).not.toContain(`>${title}</h2>`);
      }
      expect(boxes(html)).toEqual([]);
    }
    // No route of its own campaign is called: no versions, no campaigns list, nothing under the other campaign.
    expect(calls(server).filter((call) => call.includes('/versions') || call.includes('/api/v1/campaigns?') || call.includes(CROWN))).toEqual([]);
  });

  it('a cited version shared into this campaign says which it is, with a link to the newest here', async () => {
    const IN_B = `/api/v1/campaigns/${CAMPAIGN}/artifacts/${SWORD}`;
    const FROM = { ...ARTIFACT, campaignId: CROWN, version: 1, currentVersion: 2, overrides: null, related: [], sharedWith: [], sharedFrom: { campaignId: CROWN, name: 'A Coroa Partida' } };
    await useBackend({ ...BASE, [`GET ${IN_B}/versions/1`]: { status: 200, body: FROM } });
    const html = renderToStaticMarkup(
      await ArtifactPage({ params: Promise.resolve({ id: CAMPAIGN, artifactId: SWORD }), searchParams: query({ version: '1' }) }),
    );
    expect(html).toContain(ptBR.artifacts.page.citedVersion.replace('{version}', '1'));
    expect(linkTo(html, `/campaigns/${CAMPAIGN}/artifacts/${SWORD}`)).not.toBe('');
    expect(html).toContain(ptBR.artifacts.share.sharedFrom.replace('{campaign}', 'A Coroa Partida'));
  });
});

describe("an artifact's versions (Story 5.2)", () => {
  const ONE = `${ARTIFACTS}/${SWORD}`;
  const V3 = { ...ARTIFACT, recordType: 'talento', name: 'Espada Rubra', content: 'Reforjada no vulcão.', version: 3, currentVersion: 3 };
  const V1 = { ...ARTIFACT, version: 1, currentVersion: 3 };
  const THREE = {
    status: 200,
    body: {
      items: [
        { number: 3, recordType: 'talento', name: 'Espada Rubra', createdAt: '2026-11-26T15:00:00Z' },
        { number: 2, recordType: 'note', name: 'Espada lembrada', createdAt: '2026-11-26T14:00:00Z' },
        { number: 1, recordType: 'item', name: 'Espada de Kael', createdAt: '2026-11-25T12:00:00Z' },
      ],
      total: 3,
    },
  };
  const page = (values: Record<string, string> = {}) =>
    ArtifactPage({ params: Promise.resolve({ id: CAMPAIGN, artifactId: SWORD }), searchParams: query(values) });

  it('the newest version is edited in place, and "Versões" lists every version newest first, the newest "atual", the others with "Restaurar"', async () => {
    const server = await useBackend({ ...BASE, [`GET ${ONE}`]: { status: 200, body: V3 }, [VERSIONS_ROUTE]: THREE });
    for (const [language, messages] of [['pt-BR', ptBR], ['en', en]] as const) {
      cookieJar['__Host-gmshield-lang'] = language;
      const html = renderToStaticMarkup(await page());

      expect(html).toMatch(/<h1[^>]*>Espada Rubra<\/h1>/);
      // The approved type by its system's name; the content shown; "Editar" under them, and no notice of an older version.
      expect(html).toContain('Talento');
      expect(html).toContain('Reforjada no vulcão.');
      expect(html).toMatch(new RegExp(`<button[^>]*>${messages.artifacts.edit.open}</button>`));
      expect(html).not.toContain(messages.artifacts.page.citedVersion.split('{')[0]!);
      expect(html).toContain(`>${messages.artifacts.versions.title}</h2>`);
      const rows = [...html.matchAll(/<li[^>]*data-version="(\d+)"[^>]*>(.*?)<\/li>/g)];
      expect(rows.map((row) => row[1])).toEqual(['3', '2', '1']);
      expect(rows[0]![2]).toContain(`>${messages.artifacts.versions.current}<`);
      expect(rows[0]![2]).not.toContain('<button');
      expect(rows[0]![2]).toContain('aria-current="page"');
      expect(rows[1]![2]).toContain(`>${messages.artifacts.versions.restore}<`);
      expect(rows[2]![2]).toContain(messages.artifacts.versions.restoreOf.replace('{number}', '1'));
      // A row reads its number, its name and its day; the newest opens the page itself, the others their version.
      expect(rows[2]![2]).toContain(language === 'pt-BR' ? 'Versão 1 · Espada de Kael · 25 de nov. de 2026' : 'Version 1 · Espada de Kael · Nov 25, 2026');
      expect(linkTo(rows[0]![2]!, `/campaigns/${CAMPAIGN}/artifacts/${SWORD}`)).not.toBe('');
      expect(linkTo(rows[1]![2]!, amp(`/campaigns/${CAMPAIGN}/artifacts/${SWORD}?version=2&via=versions`))).not.toBe('');
      expect(html).not.toMatch(/<[^>]+\sstyle=/);
    }
    expect(calls(server)).toContain(VERSIONS_ROUTE);
  });

  it('a cited version shows as it was, read-only, with a notice naming it and a link to the newest', async () => {
    const server = await useBackend({ ...BASE, [`GET ${ONE}/versions/1`]: { status: 200, body: V1 }, [VERSIONS_ROUTE]: THREE });
    cookieJar['__Host-gmshield-lang'] = 'pt-BR';

    const html = renderToStaticMarkup(await page({ version: '1' }));

    expect(calls(server)).toContain(`GET ${ONE}/versions/1`);
    expect(html).toMatch(/<h1[^>]*>Espada de Kael<\/h1>/);
    expect(html).toContain(ptBR.systems.recordTypes.item);
    expect(html).toContain('Forjada nas montanhas do norte.');
    expect(html).toContain('Você está vendo a versão 1, citada numa resposta.');
    expect(html).toMatch(new RegExp(`<a[^>]*href="/campaigns/${CAMPAIGN}/artifacts/${SWORD}"[^>]*>${ptBR.artifacts.versions.viewCurrent}</a>`));
    // No editor on an earlier version; its row is the one shown, and the newest is still "atual".
    expect(html).not.toMatch(new RegExp(`<button[^>]*>${ptBR.artifacts.edit.open}</button>`));
    const rows = [...html.matchAll(/<li[^>]*data-version="(\d+)"[^>]*>(.*?)<\/li>/g)];
    expect(rows[2]![2]).toContain('aria-current="page"');
    expect(rows[0]![2]).toContain(`>${ptBR.artifacts.versions.current}<`);

    // Opened from "Versões", the notice names the version only; "Personagens" is kept on the way to the newest.
    await backend?.close();
    await useBackend({ ...BASE, [`GET ${ONE}/versions/1`]: { status: 200, body: V1 }, [VERSIONS_ROUTE]: THREE });
    const listed = renderToStaticMarkup(await page({ version: '1', via: 'versions', from: 'characters' }));
    expect(listed).toContain('Você está vendo a versão 1.');
    expect(listed).not.toContain('citada numa resposta');
    expect(listed).toMatch(new RegExp(`<a[^>]*href="/campaigns/${CAMPAIGN}/artifacts/${SWORD}\\?from=characters"[^>]*>${ptBR.artifacts.versions.viewCurrent}</a>`));
    expect(linkTo(listed, '/characters')).not.toBe('');
  });

  it('the newest version\'s number leads to the page\'s own address; a malformed one is ignored; an unknown one is not found', async () => {
    await useBackend({
      ...BASE,
      [`GET ${ONE}`]: { status: 200, body: V3 },
      [`GET ${ONE}/versions/3`]: { status: 200, body: V3 },
      [`GET ${ONE}/versions/9`]: problem(404, 'request.not_found'),
      [VERSIONS_ROUTE]: THREE,
    });

    // An answer's link names the version it cited; once that is the newest, the editor's own address takes over, so a
    // save or restore (which reads the address again) shows the newest version, keeping "Personagens".
    expect(await thrownDigest(() => page({ version: '3' }))).toMatch(new RegExp(`^NEXT_REDIRECT;[a-z]+;/campaigns/${CAMPAIGN}/artifacts/${SWORD};`));
    expect(await thrownDigest(() => page({ version: '3', via: 'versions', from: 'characters' }))).toMatch(
      new RegExp(`^NEXT_REDIRECT;[a-z]+;/campaigns/${CAMPAIGN}/artifacts/${SWORD}\\?from=characters;`),
    );
    for (const version of ['0', 'x', '-1', '01']) {
      const html = renderToStaticMarkup(await page({ version }));
      expect(html, version).toMatch(new RegExp(`<button[^>]*>${ptBR.artifacts.edit.open}</button>`));
      expect(html, version).not.toContain('Você está vendo');
    }
    expect(await thrownDigest(() => page({ version: '9' }))).toMatch(/^NEXT_HTTP_ERROR_FALLBACK;404/);
  });

  it('pages the versions, keeping the version shown in every page link; a list that cannot be read says why', async () => {
    const many = {
      status: 200,
      body: { items: Array.from({ length: 10 }, (_, index) => ({ number: 25 - index, recordType: 'item', name: `V${25 - index}`, createdAt: '2026-11-26T12:00:00Z' })), total: 25 },
    };
    await useBackend({
      ...BASE,
      [`GET ${ONE}/versions/1`]: { status: 200, body: { ...V1, currentVersion: 25 } },
      [`GET ${ONE}/versions?limit=10&offset=10`]: many,
    });
    const html = renderToStaticMarkup(await page({ version: '1', page: '2' }));
    expect(html).toContain(amp(`/campaigns/${CAMPAIGN}/artifacts/${SWORD}?version=1&page=3`));
    // A row opens its version on the same page of "Versões"; the newest row too.
    expect(html).toContain(amp(`/campaigns/${CAMPAIGN}/artifacts/${SWORD}?version=24&via=versions&page=2`));
    expect(html).toContain(amp(`href="/campaigns/${CAMPAIGN}/artifacts/${SWORD}?page=2"`));
    await backend?.close();

    await useBackend({ ...BASE, [`GET ${ONE}`]: { status: 200, body: V3 }, [VERSIONS_ROUTE]: problem(503, 'server.unavailable') });
    const refused = renderToStaticMarkup(await page());
    expect(refused).not.toContain(`>${ptBR.artifacts.versions.title}</h2>`);
    expect(refused).toContain('data-status="danger"');
  });
});

describe("an artifact's delete (Story 5.2 part B)", () => {
  const ONE = `${ARTIFACTS}/${SWORD}`;

  it('"Excluir" sits in the header on every version shown, and its dialog names the artifact and what goes, in both languages', async () => {
    await useBackend({
      ...BASE,
      [`GET ${ONE}`]: { status: 200, body: { ...ARTIFACT, version: 2, currentVersion: 2 } },
      [`GET ${ONE}/versions/1`]: { status: 200, body: { ...ARTIFACT, version: 1, currentVersion: 2 } },
      [VERSIONS_ROUTE]: ONE_VERSION,
    });
    for (const [language, messages] of [['pt-BR', ptBR], ['en', en]] as const) {
      cookieJar['__Host-gmshield-lang'] = language;
      for (const searchParams of [query(), query({ version: '1' })]) {
        const html = renderToStaticMarkup(await ArtifactPage({ params: Promise.resolve({ id: CAMPAIGN, artifactId: SWORD }), searchParams }));
        const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));

        expect(header).toMatch(new RegExp(`<button[^>]*data-variant="danger"[^>]*aria-haspopup="dialog"[^>]*>${messages.artifacts.delete.action}</button>`));
        expect(html).toContain(`>${messages.artifacts.delete.title.replace('{name}', 'Espada de Kael')}</h2>`);
        expect(html).toContain(messages.artifacts.delete.consequence);
        expect(html).toMatch(new RegExp(`<button[^>]*>${messages.artifacts.delete.cancel}</button>`));
        expect(html).toMatch(new RegExp(`<button[^>]*data-variant="danger"[^>]*>${messages.artifacts.delete.confirm}</button>`));
      }
    }
    expect(ptBR.artifacts.delete).toEqual({
      action: 'Excluir',
      title: 'Excluir «{name}»?',
      consequence: 'Todas as versões deste artefato vão junto. As respostas que o citaram mostram «fonte removida». Isso não pode ser desfeito.',
      consequenceShared:
        'Todas as versões deste artefato vão junto. Também sai de: {campaigns}. As respostas que o citaram mostram «fonte removida». Isso não pode ser desfeito.',
      confirm: 'Excluir artefato',
      cancel: 'Cancelar',
    });
    expect(ptBR.feedback.artifactDeleted).toBe('Artefato «{name}» excluído.');
    expect(Object.keys(en.artifacts.delete)).toEqual(Object.keys(ptBR.artifacts.delete));
  });

  it('Story 5.6 part B: a shared artifact\'s "Excluir" names the campaigns it also leaves, in its sharedWith order, on every version shown', async () => {
    const shares = [
      { campaignId: '0190a0b0-0000-7000-8000-000000000041', name: 'Mesa de domingo', archived: false },
      { campaignId: '0190a0b0-0000-7000-8000-000000000040', name: 'Mesa de sábado', archived: true },
    ];
    const server = await useBackend({
      ...BASE,
      [`GET ${ONE}`]: { status: 200, body: { ...ARTIFACT, version: 2, currentVersion: 2, sharedWith: shares, sharedFrom: null } },
      [`GET ${ONE}/versions/1`]: { status: 200, body: { ...ARTIFACT, version: 1, currentVersion: 2, sharedWith: shares, sharedFrom: null } },
      [VERSIONS_ROUTE]: ONE_VERSION,
      [`GET /api/v1/campaigns?system=${SYSTEM}&limit=50`]: { status: 200, body: { items: [THURSDAY], total: 1 } },
    });
    for (const [language, messages] of [['pt-BR', ptBR], ['en', en]] as const) {
      cookieJar['__Host-gmshield-lang'] = language;
      for (const searchParams of [query(), query({ version: '1' })]) {
        const html = renderToStaticMarkup(await ArtifactPage({ params: Promise.resolve({ id: CAMPAIGN, artifactId: SWORD }), searchParams }));
        const list = language === 'pt-BR' ? 'Mesa de domingo e Mesa de sábado' : 'Mesa de domingo and Mesa de sábado';
        expect(html).toContain(messages.artifacts.delete.consequenceShared.replace('{campaigns}', list));
      }
    }
    expect(calls(server)).toContain(`GET ${ONE}`);
    // Not shared: the consequence alone.
    await backend?.close();
    await useBackend({ ...BASE, [`GET ${ONE}`]: { status: 200, body: { ...ARTIFACT, sharedWith: [], sharedFrom: null } }, [VERSIONS_ROUTE]: ONE_VERSION });
    cookieJar['__Host-gmshield-lang'] = 'pt-BR';
    const html = renderToStaticMarkup(await ArtifactPage({ params: Promise.resolve({ id: CAMPAIGN, artifactId: SWORD }), searchParams: query() }));
    expect(html).toContain(ptBR.artifacts.delete.consequence);
    expect(html).not.toContain('Também sai de');
  });

  it('on an earlier version\'s page, "Excluir" names the artifact by its current name, not the version\'s', async () => {
    const server = await useBackend({
      ...BASE,
      [`GET ${ONE}`]: { status: 200, body: { ...ARTIFACT, name: 'Espada Rubra', version: 2, currentVersion: 2 } },
      [`GET ${ONE}/versions/1`]: { status: 200, body: { ...ARTIFACT, version: 1, currentVersion: 2 } },
      [VERSIONS_ROUTE]: ONE_VERSION,
    });
    cookieJar['__Host-gmshield-lang'] = 'pt-BR';

    const html = renderToStaticMarkup(
      await ArtifactPage({ params: Promise.resolve({ id: CAMPAIGN, artifactId: SWORD }), searchParams: query({ version: '1' }) }),
    );

    // The page shows version 1 under its own name; the delete is about the artifact, named as it is now.
    expect(html).toMatch(/<h1[^>]*>Espada de Kael<\/h1>/);
    expect(html).toContain('>Excluir «Espada Rubra»?</h2>');
    expect(html).not.toContain('Excluir «Espada de Kael»?');
    expect(calls(server)).toContain(`GET ${ONE}`);

    // The newest version's own page reads the artifact once.
    server.calls.length = 0;
    const newest = renderToStaticMarkup(await ArtifactPage({ params: Promise.resolve({ id: CAMPAIGN, artifactId: SWORD }), searchParams: query() }));
    expect(newest).toContain('>Excluir «Espada Rubra»?</h2>');
    expect(calls(server).filter((call) => call === `GET ${ONE}`)).toHaveLength(1);
  });
});

describe("an artifact's export (Story 5.7 part A)", () => {
  const ONE = `${ARTIFACTS}/${SWORD}`;
  const CROWN = '0190a0b0-0000-7000-8000-000000000045';
  /** The header's "Exportar" pill, or '' when there is none. */
  const exportPill = (html: string, messages: typeof ptBR) => {
    const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
    return new RegExp(`<button[^>]*aria-expanded="false"[^>]*>${messages.artifacts.export.action}<`).exec(header)?.[0] ?? '';
  };

  it('"Exportar" sits in the header beside "Excluir" on the newest version, with its four formats, in both languages', async () => {
    await useBackend({ ...BASE, [`GET ${ONE}`]: { status: 200, body: ARTIFACT }, [VERSIONS_ROUTE]: ONE_VERSION });
    for (const [language, messages] of [['pt-BR', ptBR], ['en', en]] as const) {
      cookieJar['__Host-gmshield-lang'] = language;
      const html = renderToStaticMarkup(await ArtifactPage({ params: Promise.resolve({ id: CAMPAIGN, artifactId: SWORD }), searchParams: query() }));
      const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));

      expect(exportPill(html, messages)).not.toBe('');
      // Before "Excluir", in the header's actions.
      expect(header.indexOf(`>${messages.artifacts.export.action}<`)).toBeLessThan(header.indexOf(`>${messages.artifacts.delete.action}<`));
      expect(header).toContain(`aria-label="${messages.artifacts.export.menu}"`);
      for (const format of ['pdf', 'txt', 'markdown', 'jpg'] as const) {
        expect(header).toContain(`>${messages.artifacts.export[format]}</button>`);
      }
    }
  });

  it('an earlier version (?version=N) has no "Exportar"', async () => {
    await useBackend({
      ...BASE,
      [`GET ${ONE}`]: { status: 200, body: { ...ARTIFACT, version: 2, currentVersion: 2 } },
      [`GET ${ONE}/versions/1`]: { status: 200, body: { ...ARTIFACT, version: 1, currentVersion: 2 } },
      [VERSIONS_ROUTE]: ONE_VERSION,
    });
    cookieJar['__Host-gmshield-lang'] = 'pt-BR';

    const html = renderToStaticMarkup(
      await ArtifactPage({ params: Promise.resolve({ id: CAMPAIGN, artifactId: SWORD }), searchParams: query({ version: '1' }) }),
    );

    expect(html).toContain(ptBR.artifacts.page.citedVersion.replace('{version}', '1'));
    expect(exportPill(html, ptBR)).toBe('');
    expect(html).not.toContain(`>${ptBR.artifacts.export.action}<`);
  });

  it('shared into this campaign, the read-only page has "Exportar" alone in its header; not on a cited version', async () => {
    const IN_B = `/api/v1/campaigns/${CAMPAIGN}/artifacts/${SWORD}`;
    const FROM = { ...ARTIFACT, campaignId: CROWN, overrides: null, related: [], sharedWith: [], sharedFrom: { campaignId: CROWN, name: 'A Coroa Partida' } };
    await useBackend({
      ...BASE,
      [`GET ${IN_B}`]: { status: 200, body: FROM },
      [`GET ${IN_B}/versions/1`]: { status: 200, body: { ...FROM, version: 1, currentVersion: 2 } },
    });
    cookieJar['__Host-gmshield-lang'] = 'pt-BR';

    const html = renderToStaticMarkup(await ArtifactPage({ params: Promise.resolve({ id: CAMPAIGN, artifactId: SWORD }), searchParams: query() }));
    expect(exportPill(html, ptBR)).not.toBe('');
    expect(html).not.toContain(`>${ptBR.artifacts.delete.action}<`);

    const cited = renderToStaticMarkup(
      await ArtifactPage({ params: Promise.resolve({ id: CAMPAIGN, artifactId: SWORD }), searchParams: query({ version: '1' }) }),
    );
    expect(exportPill(cited, ptBR)).toBe('');
  });
});

describe('"Personagens" (Story 5.1)', () => {
  it("lists the current campaign's character sheets, each opening its page, with \"Nova ficha\", in both languages", async () => {
    const server = await useBackend({
      ...BASE,
      [`GET ${ARTIFACTS}?limit=10&recordType=character_sheet`]: { status: 200, body: { items: ROWS.slice(0, 2), total: 2, types: IN_USE } },
    });
    for (const [language, messages] of [['pt-BR', ptBR], ['en', en]] as const) {
      cookieJar['__Host-gmshield-lang'] = language;
      const html = renderToStaticMarkup(await CharactersPage({ searchParams: query() }));

      expect(html).toMatch(new RegExp(`<h1[^>]*>${messages.shell.entries.characters}</h1>`));
      expect(html).toContain('Mesa de quinta');
      expect(html.indexOf('Lyra')).toBeLessThan(html.indexOf('Kael'));
      // Each row and "Nova ficha" carry `from=characters`, so the artifact page and the form lead back here.
      expect(linkTo(html, `/campaigns/${CAMPAIGN}/artifacts/${KAEL}?from=characters`)).not.toBe('');
      expect(linkTo(html, amp(`/campaigns/${CAMPAIGN}/artifacts/new?type=character_sheet&from=characters`))).toContain('data-variant="solid"');
      expect(solids(html)).toEqual([messages.characters.new]);
      expect(html).not.toMatch(/<[^>]+\sstyle=/);
    }
    expect(calls(server)).toContain(`GET ${ARTIFACTS}?limit=10&recordType=character_sheet`);
  });

  it('Story 5.6 part B: a character sheet shared into the current campaign is listed with its mark and keeps from=characters', async () => {
    const SHEET = '0190a0b0-0000-7000-8000-000000000903';
    const shared = {
      id: SHEET,
      recordType: 'character_sheet',
      name: 'Thorin',
      version: 1,
      createdAt: '2026-11-26T12:03:00Z',
      sharedFrom: { campaignId: '0190a0b0-0000-7000-8000-000000000040', name: 'A Coroa Partida' },
    };
    await useBackend({
      ...BASE,
      [`GET ${ARTIFACTS}?limit=10&recordType=character_sheet`]: {
        status: 200,
        body: { items: [shared, ...ROWS.slice(0, 2).map((row) => ({ ...row, sharedFrom: null }))], total: 3, types: IN_USE },
      },
    });
    for (const [language, messages] of [['pt-BR', ptBR], ['en', en]] as const) {
      cookieJar['__Host-gmshield-lang'] = language;
      const html = renderToStaticMarkup(await CharactersPage({ searchParams: query() }));
      const row = html.slice(html.indexOf(`href="/campaigns/${CAMPAIGN}/artifacts/${SHEET}?from=characters"`));
      // No type in "Personagens": the mark alone is the row's detail, inside its link.
      expect(row.slice(0, row.indexOf('</a>'))).toContain(`>${messages.artifacts.share.listedFrom.replace('{campaign}', 'A Coroa Partida')}<`);
      const own = html.slice(html.indexOf(`href="/campaigns/${CAMPAIGN}/artifacts/${KAEL}?from=characters"`));
      expect(own.slice(0, own.indexOf('</a>'))).not.toContain('A Coroa Partida');
    }
  });

  it('no sheet: one sentence with "Nova ficha"; no current campaign: one sentence linking to the campaigns', async () => {
    await useBackend({
      ...BASE,
      [`GET ${ARTIFACTS}?limit=10&recordType=character_sheet`]: { status: 200, body: { items: [], total: 0, types: [] } },
    });
    let html = renderToStaticMarkup(await CharactersPage({ searchParams: query() }));
    expect(html).toContain(ptBR.characters.empty);
    expect(solids(html)).toEqual([ptBR.characters.new]);
    expect(linkTo(html, amp(`/campaigns/${CAMPAIGN}/artifacts/new?type=character_sheet&from=characters`))).not.toBe('');
    await backend?.close();

    await useBackend({ 'GET /api/v1/campaigns/current': problem(404, 'request.not_found') });
    html = renderToStaticMarkup(await CharactersPage({ searchParams: query() }));
    expect(html).toContain(ptBR.characters.noCampaign);
    expect(linkTo(html, '/campaigns')).not.toBe('');
    expect(solids(html)).toEqual([]);
  });
});
