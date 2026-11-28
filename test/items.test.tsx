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
const { default: CampaignRecordPage } = await import('@/app/(signed-in)/campaigns/[id]/records/[recordId]/page');
const { default: ArtifactPage } = await import('@/app/(signed-in)/campaigns/[id]/artifacts/[artifactId]/page');
const { itemRow } = await import('@/app/(signed-in)/campaigns/rows');
const { translator } = await import('@/messages');
const ptBR = (await import('@/messages/pt-BR.json')).default;
const en = (await import('@/messages/en.json')).default;
const { startScripted } = await import('./support/servers');
type Scripted = Awaited<ReturnType<typeof startScripted>>;

const SESSION = 'sessionTokenBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const CREDENTIAL = 'configured-service-credential-0123456789';
const SYSTEM = '0190a0b0-0000-7000-8000-000000000001';
const CAMPAIGN = '0190a0b0-0000-7000-8000-000000000002';
const OTHER = '0190a0b0-0000-7000-8000-000000000040';
const DAGGER = '0190a0b0-0000-7000-8000-000000000c01';
const ROPE = '0190a0b0-0000-7000-8000-000000000c02';
const AXE = '0190a0b0-0000-7000-8000-000000000c03';
const HOUSE = '0190a0b0-0000-7000-8000-000000000c11';
const LANTERN = '0190a0b0-0000-7000-8000-000000000c12';
const THURSDAY = { id: CAMPAIGN, name: 'Mesa de quinta', system: { id: SYSTEM, name: 'D&D', edition: null, description: null, version: 0 }, archived: false, version: 0 };
const SCOPE = { version: 0, campaignTier: true, systemTier: true, otherTier: false, modelKnowledge: false, materials: [] };
const ME = { id: '0190a0b0-0000-7000-8000-000000000099', username: 'mestre_dalton' };

const record = (id: string, name: string, tier: 'campaign' | 'system' | 'other', materialName: string, page: number) => ({
  kind: 'record',
  id,
  name,
  recordType: 'item',
  tier,
  materialName,
  page,
  sharedFrom: null,
  overrides: null,
});
const artifact = (id: string, name: string, more: Record<string, unknown> = {}) => ({
  kind: 'artifact',
  id,
  name,
  recordType: 'item',
  tier: null,
  materialName: null,
  page: null,
  sharedFrom: null,
  overrides: null,
  ...more,
});
/** A system record, the GM's item that overrides another record, one of another system's book and one shared in. */
const ENTRIES = [
  record(DAGGER, 'Adaga', 'system', 'Livro do Jogador', 150),
  record(AXE, 'Machado de guerra', 'other', 'Outro livro', 12),
  artifact(HOUSE, 'Punhal da casa', { overrides: { recordId: ROPE, name: 'Corda de seda' } }),
  artifact(LANTERN, 'Lanterna', { sharedFrom: { campaignId: OTHER, name: 'A Coroa Partida' } }),
];

const ITEMS = `/api/v1/campaigns/${CAMPAIGN}/items`;
const BASE = {
  [`GET /api/v1/campaigns/${CAMPAIGN}`]: { status: 200, body: THURSDAY },
  'GET /api/v1/campaigns/current': { status: 200, body: THURSDAY },
  [`GET /api/v1/campaigns/${CAMPAIGN}/deletion`]: { status: 200, body: { conversations: 0, materials: 0, artifacts: 3 } },
  [`GET /api/v1/campaigns/${CAMPAIGN}/scope`]: { status: 200, body: SCOPE },
  'GET /api/v1/me': { status: 200, body: ME },
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

const params = (id: string) => Promise.resolve({ id });
const query = (values: Record<string, string> = {}) => Promise.resolve(values);
/** The opening tag of the link to `href`, whatever its attributes' order; '' when there is none. */
const linkTo = (html: string, href: string) => [...html.matchAll(/<a\b[^>]*>/g)].map((match) => match[0]).find((tag) => tag.includes(`href="${href}"`)) ?? '';
/** The text of the link to `href`, its tags dropped; '' when there is none. */
function linkText(html: string, href: string): string {
  const start = html.indexOf(`href="${href}"`);
  if (start === -1) {
    return '';
  }
  return html.slice(start, html.indexOf('</a>', start)).replace(/^[^>]*>/, '').replace(/<[^>]+>/g, '');
}
/** The texts of every link to `href`, their tags dropped. */
const linkTexts = (html: string, href: string) =>
  [...html.matchAll(/<a\b([^>]*)>(.*?)<\/a>/g)].filter((match) => (match[1] ?? '').includes(`href="${href}"`)).map((match) => (match[2] ?? '').replace(/<[^>]+>/g, ''));
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

describe("a campaign's item encyclopedia (Story 7.2)", () => {
  it('is the last tab, listing records and custom items in the backend\'s order, each with its tier pill and detail, in both languages', async () => {
    const server = await useBackend({ ...BASE, [`GET ${ITEMS}?limit=10`]: { status: 200, body: { items: ENTRIES, total: 4 } } });
    for (const [language, messages] of [['pt-BR', ptBR], ['en', en]] as const) {
      cookieJar['__Host-gmshield-lang'] = language;
      const html = renderToStaticMarkup(await CampaignPage({ params: params(CAMPAIGN), searchParams: query({ tab: 'items' }) }));

      // The tab, last and current.
      const tabs = [...html.matchAll(/href="\/campaigns\/[^"?]+\?tab=([a-z]+)"/g)].map((match) => match[1]);
      expect(tabs.at(-1)).toBe('items');
      expect(linkTo(html, `/campaigns/${CAMPAIGN}?tab=items`)).toContain('aria-current="page"');
      expect(html).toContain(`>${messages.campaigns.page.items}</a>`);
      expect(html).toContain(`aria-label="${messages.items.list}"`);
      // The rows in the backend's order.
      expect(html.indexOf('Adaga')).toBeLessThan(html.indexOf('Machado de guerra'));
      expect(html.indexOf('Machado de guerra')).toBeLessThan(html.indexOf('Punhal da casa'));
      expect(html.indexOf('Punhal da casa')).toBeLessThan(html.indexOf('Lanterna'));
      // A record: its tier pill, "{material}, p. {page}", and its campaign record page, leading back here.
      const dagger = linkText(html, amp(`/campaigns/${CAMPAIGN}/records/${DAGGER}?from=items`));
      expect(dagger).toContain(messages.shell.scope.system);
      expect(dagger).toContain('Livro do Jogador, p. 150');
      expect(linkText(html, amp(`/campaigns/${CAMPAIGN}/records/${AXE}?from=items`))).toContain(messages.shell.scope.other);
      // A custom item: "Personalizado", "por {username}", what it replaces, and its artifact page, leading back here.
      const house = linkText(html, amp(`/campaigns/${CAMPAIGN}/artifacts/${HOUSE}?from=items`));
      expect(house).toContain(messages.shell.scope.custom);
      expect(house).toContain(`${messages.items.by.replace('{username}', 'mestre_dalton')} · ${messages.items.replaces.replace('{name}', 'Corda de seda')}`);
      expect(house).not.toContain(messages.shell.scope.system);
      // Shared in: "Compartilhado de {A}".
      const lantern = linkText(html, amp(`/campaigns/${CAMPAIGN}/artifacts/${LANTERN}?from=items`));
      expect(lantern).toContain(messages.shell.scope.custom);
      expect(lantern).toContain(messages.artifacts.share.listedFrom.replace('{campaign}', 'A Coroa Partida'));
      // The filter: a bordered search field in a GET form to this page, and "Exibição".
      expect(html).toMatch(/<form[^>]*role="search"/);
      expect(html).toMatch(/<input[^>]*type="hidden"[^>]*name="tab"[^>]*value="items"/);
      expect(html).toMatch(/<input[^>]*type="search"[^>]*name="q"/);
      expect(html).toContain(`>${messages.items.filter}</label>`);
      expect(html).toContain(messages.view.menu);
      expect(html).not.toMatch(/<[^>]+\sstyle=/);
    }
    expect(calls(server)).toContain(`GET ${ITEMS}?limit=10`);
    expect(ptBR.shell.scope.custom).toBe('Personalizado');
    expect(en.shell.scope.custom).toBe('Custom');
  });

  it('a filter is sent as q, kept in the field and by every page link', async () => {
    const server = await useBackend({
      ...BASE,
      [`GET ${ITEMS}?limit=10&offset=10&q=adaga`]: { status: 200, body: { items: [ENTRIES[0]], total: 21 } },
    });

    const html = renderToStaticMarkup(await CampaignPage({ params: params(CAMPAIGN), searchParams: query({ tab: 'items', q: '  adaga ', page: '2' }) }));

    expect(calls(server)).toContain(`GET ${ITEMS}?limit=10&offset=10&q=adaga`);
    expect(html).toMatch(/<input[^>]*name="q"[^>]*value="adaga"/);
    expect(linkTo(html, amp(`/campaigns/${CAMPAIGN}?tab=items&q=adaga&page=2`))).toContain('aria-current="page"');
    expect(linkTo(html, amp(`/campaigns/${CAMPAIGN}?tab=items&q=adaga&page=3`))).not.toBe('');
  });

  it('a filter over 200 code points is cut to its first 200 before it is sent, and the list renders', async () => {
    const wide = String.fromCodePoint(0x1d538);
    const sent = encodeURIComponent(wide.repeat(200));
    const server = await useBackend({ ...BASE, [`GET ${ITEMS}?limit=10&q=${sent}`]: { status: 200, body: { items: [ENTRIES[0]], total: 1 } } });

    const html = renderToStaticMarkup(await CampaignPage({ params: params(CAMPAIGN), searchParams: query({ tab: 'items', q: wide.repeat(201) }) }));

    expect(calls(server)).toContain(`GET ${ITEMS}?limit=10&q=${sent}`);
    expect(html).toContain('Adaga');
    expect(html).toContain(`value="${wide.repeat(200)}"`);
    expect(html).not.toContain(wide.repeat(201));
  });

  it('a filter with no match names the scope searched with "Limpar filtro"; an empty campaign says so with "Novo artefato"', async () => {
    await useBackend({
      ...BASE,
      [`GET ${ITEMS}?limit=10&q=zzz`]: { status: 200, body: { items: [], total: 0 } },
      [`GET ${ITEMS}?limit=10`]: { status: 200, body: { items: [], total: 0 } },
    });
    for (const [language, messages, tiers] of [
      ['pt-BR', ptBR, 'Campanha e Sistema'],
      ['en', en, 'Campaign and System'],
    ] as const) {
      cookieJar['__Host-gmshield-lang'] = language;
      const scope = messages.items.scope.replace('{tiers}', tiers);

      let html = renderToStaticMarkup(await CampaignPage({ params: params(CAMPAIGN), searchParams: query({ tab: 'items', q: 'zzz' }) }));
      expect(html).toContain(messages.items.noMatch.replace('{query}', 'zzz').replace('{scope}', scope).replaceAll("'", '&#x27;'));
      // The tab and "Limpar filtro" both lead to the unfiltered tab.
      expect(linkTexts(html, `/campaigns/${CAMPAIGN}?tab=items`)).toEqual([messages.campaigns.page.items, messages.items.clear]);
      expect(html).toMatch(/<input[^>]*name="q"[^>]*value="zzz"/);

      html = renderToStaticMarkup(await CampaignPage({ params: params(CAMPAIGN), searchParams: query({ tab: 'items' }) }));
      expect(html).toContain(messages.items.empty.replace('{scope}', scope).replaceAll("'", '&#x27;'));
      expect(linkTo(html, amp(`/campaigns/${CAMPAIGN}/artifacts/new?type=item&from=items`))).toContain('data-variant="solid"');
      expect(html).not.toMatch(/<form[^>]*role="search"/);
    }
  });

  it('the empty sentence names only the tiers that are on, "Nenhuma fonte" with none, and the scope alone when it cannot be read', async () => {
    const routes = {
      ...BASE,
      [`GET /api/v1/campaigns/${CAMPAIGN}/scope`]: { status: 200, body: { ...SCOPE, campaignTier: false, systemTier: false } },
      [`GET ${ITEMS}?limit=10`]: { status: 200, body: { items: [], total: 0 } },
    };
    await useBackend(routes);
    let html = renderToStaticMarkup(await CampaignPage({ params: params(CAMPAIGN), searchParams: query({ tab: 'items' }) }));
    expect(html).toContain(ptBR.items.empty.replace('{scope}', ptBR.items.scope.replace('{tiers}', ptBR.shell.scope.none)));

    await backend?.close();
    await useBackend({ ...routes, [`GET /api/v1/campaigns/${CAMPAIGN}/scope`]: problem(503, 'server.unavailable') });
    html = renderToStaticMarkup(await CampaignPage({ params: params(CAMPAIGN), searchParams: query({ tab: 'items' }) }));
    expect(html).toContain(ptBR.items.empty.replace('{scope}', ptBR.items.scopeUnread));
  });

  it('loads nothing of the encyclopedia on another tab, and a list that cannot be read says why', async () => {
    const server = await useBackend({ ...BASE, [`GET ${ITEMS}?limit=10`]: problem(503, 'server.unavailable') });

    renderToStaticMarkup(await CampaignPage({ params: params(CAMPAIGN), searchParams: query() }));
    expect(calls(server).filter((call) => call.includes('/items') || call.includes('/scope') || call.includes('/me'))).toEqual([]);

    const html = renderToStaticMarkup(await CampaignPage({ params: params(CAMPAIGN), searchParams: query({ tab: 'items' }) }));
    expect(html).toContain('O serviço está indisponível agora. Tente de novo em instantes.');
    // The scope tab's controls are not drawn here, though the scope was read.
    expect(html).not.toContain(`aria-label="${ptBR.shell.scope.panel}"`);
  });

  it('a custom item without the session\'s username leaves the author out', () => {
    const t = translator('pt-BR');
    const row = itemRow(artifact(HOUSE, 'Punhal da casa') as Parameters<typeof itemRow>[0], `/campaigns/${CAMPAIGN}`, null, t);
    expect(row).toMatchObject({ detail: null, tier: 'custom', href: `/campaigns/${CAMPAIGN}/artifacts/${HOUSE}?from=items` });
  });
});

describe("a record in a campaign's context (Story 7.2)", () => {
  const RECORD = {
    id: ROPE,
    name: 'Corda de seda',
    recordType: { id: '0190a0b0-0000-7000-8000-000000000602', core: 'item', key: 'item', name: 'item' },
    fields: [{ name: 'Peso', value: '0,5 kg' }],
    references: [
      { versionId: '0190a0b0-0000-7000-8000-000000000a01', materialName: 'Livro do Jogador', sectionPath: ['Equipamento'], page: 150, passageIds: ['0190a0b0-0000-7000-8000-000000000a02'] },
    ],
    version: 0,
    related: [],
  };
  const ROUTE = `GET /api/v1/campaigns/${CAMPAIGN}/records/${ROPE}`;

  it('opens through the address\'s campaign, with its fields, its references on the scope\'s ground, and the way back to the encyclopedia, in both languages', async () => {
    const related = [{ artifactId: HOUSE, name: 'Punhal da casa', recordType: 'item' }];
    const server = await useBackend({
      [ROUTE]: { status: 200, body: { ...RECORD, related } },
      [`GET /api/v1/campaigns/${CAMPAIGN}`]: { status: 200, body: THURSDAY },
      [`GET /api/v1/systems/${SYSTEM}/record-types?limit=50`]: { status: 200, body: { items: [], total: 0 } },
    });
    for (const [language, messages] of [['pt-BR', ptBR], ['en', en]] as const) {
      cookieJar['__Host-gmshield-lang'] = language;
      const html = renderToStaticMarkup(
        await CampaignRecordPage({ params: Promise.resolve({ id: CAMPAIGN, recordId: ROPE }), searchParams: query({ from: 'items' }) }),
      );
      expect(html).toContain('>Corda de seda</h1>');
      expect(html).toContain(messages.systems.recordTypes.item);
      expect(html).toContain('0,5 kg');
      expect(html).toContain('Livro do Jogador');
      expect(linkText(html, `/campaigns/${CAMPAIGN}?tab=items`)).toBe(messages.campaigns.page.items);
      expect(html).toContain('Livro do Jogador, Equipamento, p. 150');
      // A related artifact's page leads back to the encyclopedia too.
      expect(linkText(html, amp(`/campaigns/${CAMPAIGN}/artifacts/${HOUSE}?from=items`))).toContain('Punhal da casa');
    }
    // The address's campaign, never the current one; no correction is offered here.
    expect(calls(server).filter((call) => call.includes('/records/'))).toEqual([ROUTE, ROUTE]);
    expect(calls(server)).not.toContain('GET /api/v1/campaigns/current');
  });

  it('opened from an artifact\'s "Substituição", leads back to that artifact, keeping where it was opened from', async () => {
    await useBackend({ [ROUTE]: { status: 200, body: RECORD } });
    let html = renderToStaticMarkup(
      await CampaignRecordPage({ params: Promise.resolve({ id: CAMPAIGN, recordId: ROPE }), searchParams: query({ artifact: HOUSE }) }),
    );
    expect(linkText(html, `/campaigns/${CAMPAIGN}/artifacts/${HOUSE}`)).toBe(ptBR.items.record.backArtifact);
    html = renderToStaticMarkup(
      await CampaignRecordPage({ params: Promise.resolve({ id: CAMPAIGN, recordId: ROPE }), searchParams: query({ artifact: HOUSE, from: 'items' }) }),
    );
    expect(linkText(html, `/campaigns/${CAMPAIGN}/artifacts/${HOUSE}?from=items`)).toBe(ptBR.items.record.backArtifact);
    // Opened from "Personagens", that is kept too.
    html = renderToStaticMarkup(
      await CampaignRecordPage({ params: Promise.resolve({ id: CAMPAIGN, recordId: ROPE }), searchParams: query({ artifact: HOUSE, from: 'characters' }) }),
    );
    expect(linkText(html, `/campaigns/${CAMPAIGN}/artifacts/${HOUSE}?from=characters`)).toBe(ptBR.items.record.backArtifact);
    // A malformed artifact id is ignored: back to the encyclopedia.
    html = renderToStaticMarkup(
      await CampaignRecordPage({ params: Promise.resolve({ id: CAMPAIGN, recordId: ROPE }), searchParams: query({ artifact: 'x' }) }),
    );
    expect(linkText(html, `/campaigns/${CAMPAIGN}?tab=items`)).toBe(ptBR.campaigns.page.items);
  });

  it('a record out of the campaign\'s scope is "Não encontrado."', async () => {
    await useBackend({ [ROUTE]: problem(404, 'request.not_found') });
    let digest = '';
    try {
      await CampaignRecordPage({ params: Promise.resolve({ id: CAMPAIGN, recordId: ROPE }), searchParams: query({ from: 'items' }) });
    } catch (error) {
      digest = String((error as { digest?: unknown }).digest ?? '');
    }
    expect(digest).toContain('404');
  });

  it('an artifact opened from the encyclopedia leads back to it, and its "Substituição" opens the record here, keeping that', async () => {
    const SWORD = HOUSE;
    const ARTIFACT = {
      id: SWORD,
      campaignId: CAMPAIGN,
      recordType: 'item',
      name: 'Punhal da casa',
      fields: [],
      content: null,
      version: 1,
      currentVersion: 1,
      createdAt: '2026-11-26T12:00:00Z',
      conversationId: null,
      references: [],
      overrides: { recordId: ROPE, name: 'Corda de seda', recordType: 'item', systemId: SYSTEM, removed: false },
      related: [],
      sharedWith: [],
      sharedFrom: null,
      shieldId: null,
    };
    await useBackend({
      ...BASE,
      [`GET /api/v1/campaigns/${CAMPAIGN}/artifacts/${SWORD}`]: { status: 200, body: ARTIFACT },
      [`GET /api/v1/campaigns/${CAMPAIGN}/artifacts/${SWORD}/versions?limit=10`]: {
        status: 200,
        body: { items: [{ number: 1, recordType: 'item', name: 'Punhal da casa', createdAt: '2026-11-26T12:00:00Z' }], total: 25 },
      },
      [`GET /api/v1/systems/${SYSTEM}/record-types?limit=50`]: { status: 200, body: { items: [], total: 0 } },
      'GET /api/v1/campaigns?limit=50': { status: 200, body: { items: [], total: 0 } },
      [ROUTE]: { status: 200, body: RECORD },
    });
    const html = renderToStaticMarkup(
      await ArtifactPage({ params: Promise.resolve({ id: CAMPAIGN, artifactId: SWORD }), searchParams: Promise.resolve({ from: 'items' }) }),
    );
    expect(linkText(html, `/campaigns/${CAMPAIGN}?tab=items`)).toBe(ptBR.campaigns.page.items);
    expect(linkText(html, amp(`/campaigns/${CAMPAIGN}/records/${ROPE}?from=items&artifact=${SWORD}`))).toBe('Corda de seda');
    // "Versões" pages keep it.
    expect(linkTo(html, amp(`/campaigns/${CAMPAIGN}/artifacts/${SWORD}?from=items&page=2`))).not.toBe('');

    // Opened from "Personagens", the record's link keeps that instead, so the round trip ends there.
    const characters = renderToStaticMarkup(
      await ArtifactPage({ params: Promise.resolve({ id: CAMPAIGN, artifactId: SWORD }), searchParams: Promise.resolve({ from: 'characters' }) }),
    );
    expect(linkText(characters, '/characters')).toBe(ptBR.shell.entries.characters);
    expect(linkText(characters, amp(`/campaigns/${CAMPAIGN}/records/${ROPE}?from=characters&artifact=${SWORD}`))).toBe('Corda de seda');
    const record = renderToStaticMarkup(
      await CampaignRecordPage({
        params: Promise.resolve({ id: CAMPAIGN, recordId: ROPE }),
        searchParams: query({ from: 'characters', artifact: SWORD }),
      }),
    );
    expect(linkText(record, `/campaigns/${CAMPAIGN}/artifacts/${SWORD}?from=characters`)).toBe(ptBR.items.record.backArtifact);
  });
});
