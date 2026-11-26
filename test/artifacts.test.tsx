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
/** The solid pills of a page: links or buttons whose variant is solid. */
const solids = (html: string) => [...html.matchAll(/<(a|button)[^>]*data-variant="solid"[^>]*>(.*?)<\/\1>/g)].map((match) => match[2]);
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
  it('shows the name, the type as the subtitle, the fields as a two-column list, the content as plain text and no sources', async () => {
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
      // Plain text: the markup the GM typed is shown as text, never as HTML.
      expect(html).toContain('Forjada nas montanhas do norte.\n&lt;b&gt;Brilha&lt;/b&gt; perto de orcs.');
      expect(html).not.toContain('<b>Brilha');
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
    expect(calls(server)).not.toContain(`GET ${ONE}`);
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
