// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Story 3.10 part A, the server's side: each area's list of the current campaign's conversations, a new conversation,
 * an opened one with its stored turns, and the rename (its page and its Server Action). The browser's side (examples,
 * the composer's focus, the address once the first question made the conversation, a stored turn still being written)
 * is in `test/conversation.test.tsx`. Story 3.10 part B: "Excluir" on an opened conversation, with the count its page
 * reads, and its Server Action.
 */
let cookieJar: Record<string, string> = {};
const setCookie = vi.fn();
vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) => (Object.hasOwn(cookieJar, name) ? { name, value: cookieJar[name] } : undefined),
    set: (...args: unknown[]) => setCookie(...args),
  }),
}));
// The pages' client parts ask for the router; outside Next.js there is none.
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ refresh: () => undefined, push: () => undefined, replace: () => undefined, prefetch: () => undefined }),
}));
const revalidatePath = vi.fn();
vi.mock('next/cache', () => ({ refresh: () => undefined, revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));

const { createElement } = await import('react');
const { renderToStaticMarkup } = await import('react-dom/server');
const { UploadsProvider } = await import('@/components/uploads/UploadsProvider');
const { uploadTexts } = await import('@/components/uploads/upload-texts');
const { NO_PLACES } = await import('@/components/uploads/types');
const { default: QuestionsPage } = await import('@/app/(signed-in)/questions/page');
const { default: RulesPage } = await import('@/app/(signed-in)/rules/page');
const { default: NewRulesConversationPage } = await import('@/app/(signed-in)/rules/new/page');
const { default: QuestionsConversationPage } = await import('@/app/(signed-in)/questions/[id]/page');
const { default: RulesConversationPage } = await import('@/app/(signed-in)/rules/[id]/page');
const { default: RenameRulesConversationPage } = await import('@/app/(signed-in)/rules/[id]/edit/page');
const { deleteConversationAction, renameConversationAction } = await import('@/app/(signed-in)/conversation-actions');
const { default: NewQuestionsConversationPage } = await import('@/app/(signed-in)/questions/new/page');
const { FLASH_COOKIE, flashFrom } = await import('@/flash-cookie');
const ptBR = (await import('@/messages/pt-BR.json')).default;
const en = (await import('@/messages/en.json')).default;
const { startScripted } = await import('./support/servers');
type Scripted = Awaited<ReturnType<typeof startScripted>>;

const SESSION = 'sessionTokenBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const CREDENTIAL = 'configured-service-credential-0123456789';
const CAMPAIGN = '0190a0b0-0000-7000-8000-000000000002';
const FIRST = '0190a0b0-0000-7000-8000-000000000020';
const SECOND = '0190a0b0-0000-7000-8000-000000000022';
const RULES_ID = '0190a0b0-0000-7000-8000-000000000023';
const TURN = '0190a0b0-0000-7000-8000-000000000021';
/** Story 5.4 part B: two artifacts saved from a conversation. */
const ARTIFACT_A = '0190a0b0-0000-7000-8000-000000000903';
const ARTIFACT_B = '0190a0b0-0000-7000-8000-000000000904';
const PASSAGE = '0190a0b0-0000-7000-8000-000000000009';
const CURRENT = { status: 200, body: { campaignId: CAMPAIGN, hasSources: true, indexing: null, indexingFailed: null } };
const NO_REVIEW = { status: 200, body: { items: [], total: 0 } };
const REVIEW = 'GET /api/v1/materials?state=needs_review&limit=1';
const summary = (id: string, name: string, questions: number, lastAskedAt: string, area = 'questions') => ({
  id,
  area,
  name,
  questions,
  createdAt: '2026-11-20T10:00:00Z',
  lastAskedAt,
  version: 0,
});
const RULES = { id: RULES_ID, campaignId: CAMPAIGN, area: 'rules', name: 'Fabricar itens', version: 3 };
const STORED = {
  id: TURN,
  question: 'Que regras já existem sobre fabricar itens?',
  language: 'pt-BR',
  createdAt: '2026-11-22T12:00:00Z',
  events: [
    { sequence: 1, type: 'delta', data: { text: 'Fabricar leva um dia por 5 PO.' } },
    { sequence: 2, type: 'citation', data: { passageId: PASSAGE, offset: 30 } },
    {
      sequence: 3,
      type: 'done',
      data: {
        stopped: false,
        silent: false,
        modelKnowledge: false,
        references: [{ number: 1, materialName: 'Livro do Jogador.pdf', sectionPath: ['Ofícios'], page: 187, passageIds: [PASSAGE], removed: false, tier: 'system' }],
      },
    },
  ],
};

let backend: Scripted | undefined;
async function useBackend(routes: Parameters<typeof startScripted>[0]): Promise<Scripted> {
  backend = await startScripted(routes);
  vi.stubEnv('GMSHIELD_MODE', '');
  vi.stubEnv('GMSHIELD_BACKEND_URL', backend.url);
  vi.stubEnv('GMSHIELD_FRONTEND_CREDENTIAL', CREDENTIAL);
  return backend;
}

function problem(status: number, code: string, params: Record<string, number> = {}) {
  return { status, body: { type: `urn:gmshield:problem:${code}`, title: 'x', status, category: code.split('.')[0], code, params, traceId: 't' } };
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    data.set(key, value);
  }
  return data;
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

const query = (values: Record<string, string> = {}) => Promise.resolve(values);
const params = (id: string) => Promise.resolve({ id });
/** A conversation screen as the signed-in layout holds it: inside the uploads' provider, which its empty state uses. */
const inShell = (page: unknown) =>
  renderToStaticMarkup(createElement(UploadsProvider, { texts: uploadTexts('pt-BR'), belonging: NO_PLACES, children: page as never }));
/** The opening tag of the link to `href`, whatever its attributes' order; '' when there is none. */
const linkTo = (html: string, href: string) => [...html.matchAll(/<a\b[^>]*>/g)].map((match) => match[0]).find((tag) => tag.includes(`href="${href}"`)) ?? '';
/** The solid pills of a page: links or buttons whose variant is solid. */
const solids = (html: string) => [...html.matchAll(/<(a|button)[^>]*data-variant="solid"[^>]*>(.*?)<\/\1>/g)].map((match) => match[2]);
const calls = (server: Scripted) => server.calls.map((call) => `${call.method} ${call.url}`);

beforeEach(() => {
  cookieJar = { '__Host-gmshield-session': `${SESSION}.9999999999` };
  setCookie.mockReset();
  revalidatePath.mockReset();
});

afterEach(async () => {
  await backend?.close();
  backend = undefined;
  vi.unstubAllEnvs();
});

describe('each area lists its conversations (Story 3.10)', () => {
  it('Consultas lists only the questions conversations, most recently asked first, with "Nova conversa" and a pager', async () => {
    const server = await useBackend({
      'GET /api/v1/conversations/current': CURRENT,
      'GET /api/v1/campaigns/0190a0b0-0000-7000-8000-000000000002/conversations?area=questions&limit=10': {
        status: 200,
        body: {
          items: [
            summary(SECOND, 'O que a campanha diz sobre viagens?', 1, '2026-11-22T09:00:00Z'),
            summary(FIRST, 'Como funciona o descanso dos personagens?', 3, '2026-11-21T18:00:00Z'),
          ],
          total: 2,
        },
      },
    });

    const html = renderToStaticMarkup(await QuestionsPage({ searchParams: query() }));

    // Only the questions area is asked for, of the current campaign, with the session.
    expect(calls(server)).toContain(`GET /api/v1/campaigns/${CAMPAIGN}/conversations?area=questions&limit=10`);
    expect(server.calls.at(-1)?.headers['x-session-token']).toBe(SESSION);
    expect(html).toContain(`<h1`);
    expect(html).toContain(ptBR.shell.entries.questions);
    expect(solids(html)).toEqual([ptBR.conversations.new]);
    expect(linkTo(html, '/questions/new')).toContain('data-variant="solid"');
    // In the backend's order: the most recently asked first, each opening its conversation.
    expect(html.indexOf('O que a campanha diz sobre viagens?')).toBeLessThan(html.indexOf('Como funciona o descanso dos personagens?'));
    expect(html).toContain(`href="/questions/${SECOND}"`);
    expect(html).toContain(`href="/questions/${FIRST}"`);
    // "N perguntas" and the date of the last question.
    expect(html).toContain('1 pergunta · última em 22 de nov. de 2026');
    expect(html).toContain('3 perguntas · última em 21 de nov. de 2026');
    expect(html).toContain(`aria-label="${ptBR.conversations.listQuestions}"`);
    expect(html).not.toMatch(/<[^>]+\sstyle=/);
  });

  it('Criação de Regras lists the rules area, on page 2 with the offset, in English too', async () => {
    cookieJar['__Host-gmshield-lang'] = 'en';
    const server = await useBackend({
      'GET /api/v1/conversations/current': CURRENT,
      'GET /api/v1/campaigns/0190a0b0-0000-7000-8000-000000000002/conversations?area=rules&limit=10&offset=10': {
        status: 200,
        body: { items: [summary(RULES_ID, 'Fabricar itens', 2, '2026-11-22T09:00:00Z', 'rules')], total: 11 },
      },
    });

    const html = renderToStaticMarkup(await RulesPage({ searchParams: query({ page: '2' }) }));

    expect(calls(server)).toContain(`GET /api/v1/campaigns/${CAMPAIGN}/conversations?area=rules&limit=10&offset=10`);
    expect(html).toContain(en.shell.entries.rules);
    expect(solids(html)).toEqual([en.conversations.new]);
    expect(linkTo(html, '/rules/new')).not.toBe('');
    expect(html).toContain(`href="/rules/${RULES_ID}"`);
    expect(html).toContain('2 questions · last on Nov 22, 2026');
    // The pager names the page, and leads back to the first one.
    expect(html).toContain('href="/rules"');
  });

  it('an empty list says so in one sentence with "Nova conversa"; with no campaign it offers a new campaign', async () => {
    await useBackend({
      'GET /api/v1/conversations/current': CURRENT,
      'GET /api/v1/campaigns/0190a0b0-0000-7000-8000-000000000002/conversations?area=rules&limit=10': { status: 200, body: { items: [], total: 0 } },
    });
    let html = renderToStaticMarkup(await RulesPage({ searchParams: query() }));
    expect(html).toContain(ptBR.conversations.emptyRules);
    // One solid pill, in the header; the sentence's own "Nova conversa" is outlined.
    expect(solids(html)).toEqual([ptBR.conversations.new]);
    expect(html.match(/href="\/rules\/new"/g)).toHaveLength(2);
    expect(html).not.toContain('<ul');
    await backend!.close();

    await useBackend({ 'GET /api/v1/conversations/current': problem(404, 'request.not_found') });
    html = renderToStaticMarkup(await QuestionsPage({ searchParams: query() }));
    expect(html).toContain(ptBR.conversation.noCampaign);
    expect(html).toContain('href="/campaigns/new"');
    expect(html).not.toContain('href="/questions/new"');
    expect(html).not.toContain(ptBR.notFound.title);
  });

  it('a list that cannot be loaded says why', async () => {
    await useBackend({
      'GET /api/v1/conversations/current': CURRENT,
      'GET /api/v1/campaigns/0190a0b0-0000-7000-8000-000000000002/conversations?area=questions&limit=10': problem(503, 'server.unavailable'),
    });
    const html = renderToStaticMarkup(await QuestionsPage({ searchParams: query() }));
    expect(html).toContain('O serviço está indisponível agora. Tente de novo em instantes.');
    expect(solids(html)).toEqual([ptBR.conversations.new]);
  });
});

describe('a new and an opened conversation (Story 3.10)', () => {
  it('a new conversation of Criação de Regras shows its heading, its three examples and the way back, and no name', async () => {
    await useBackend({ 'GET /api/v1/conversations/current': CURRENT, [REVIEW]: NO_REVIEW });

    const html = inShell(await NewRulesConversationPage());

    expect(html).toContain('Que regra você quer criar?');
    for (const example of Object.values(ptBR.conversation.examples.rules)) {
      expect(html).toContain(`>${example}</button>`);
    }
    expect(html).toContain('href="/rules"');
    expect(html).toContain(`>${ptBR.shell.entries.rules}</a>`);
    expect(html).not.toContain(ptBR.conversation.rename);
    expect(html).toContain('<textarea');
  });

  it('an opened conversation shows its stored turns with their references, its name and "Renomear"', async () => {
    const server = await useBackend({
      'GET /api/v1/conversations/current': CURRENT,
      [REVIEW]: NO_REVIEW,
      [`GET /api/v1/conversations/${RULES_ID}`]: { status: 200, body: RULES },
      [`GET /api/v1/conversations/${RULES_ID}/turns`]: { status: 200, body: { items: [STORED] } },
    });

    const html = inShell(await RulesConversationPage({ params: params(RULES_ID) }));

    expect(calls(server)).toEqual(expect.arrayContaining([`GET /api/v1/conversations/${RULES_ID}`, `GET /api/v1/conversations/${RULES_ID}/turns`]));
    expect(html).toContain('Que regras já existem sobre fabricar itens?');
    expect(html).toContain('Fabricar leva um dia por 5 PO.');
    expect(html).toContain('Livro do Jogador.pdf');
    expect(html).toContain('<sup');
    expect(html).toContain('Fabricar itens');
    expect(linkTo(html, `/rules/${RULES_ID}/edit`)).not.toBe('');
    expect(html).toContain(`>${ptBR.conversation.rename}</a>`);
    expect(html).toContain('href="/rules"');
    // A conversation with turns shows no intro and no examples.
    expect(html).not.toContain('Que regra você quer criar?');
  });

  it('Story 4.4 part B: an opened conversation names a cited record of a type the GM approved by the campaign system\'s type', async () => {
    const SYSTEM = '0190a0b0-0000-7000-8000-000000000001';
    const RECORD = '0190a0b0-0000-7000-8000-000000000703';
    const talent = { id: '0190a0b0-0000-7000-8000-000000000608', name: 'Talento', core: null, key: 'talento', origin: { kind: 'proposal' }, records: 3, version: 0 };
    const spell = { id: '0190a0b0-0000-7000-8000-000000000601', name: 'spell', core: 'spell', key: 'spell', origin: { kind: 'core' }, records: 0, version: 0 };
    const cited = {
      ...STORED,
      events: [
        { sequence: 1, type: 'delta', data: { text: 'Ataque Poderoso troca precisão por dano.' } },
        { sequence: 2, type: 'citation', data: { recordId: RECORD, offset: 39 } },
        {
          sequence: 3,
          type: 'done',
          data: {
            stopped: false,
            silent: false,
            modelKnowledge: false,
            references: [
              {
                number: 1,
                kind: 'record',
                recordId: RECORD,
                recordType: 'talento',
                name: 'Ataque Poderoso',
                fields: [{ name: 'Benefício', value: '+10 no dano' }],
                materialName: 'Livro do Jogador.pdf',
                sectionPath: ['Talentos'],
                page: 168,
                passageIds: [PASSAGE],
                removed: false,
                tier: 'system',
              },
            ],
          },
        },
      ],
    };
    const server = await useBackend({
      'GET /api/v1/conversations/current': CURRENT,
      [REVIEW]: NO_REVIEW,
      [`GET /api/v1/conversations/${RULES_ID}`]: { status: 200, body: RULES },
      [`GET /api/v1/conversations/${RULES_ID}/turns`]: { status: 200, body: { items: [cited] } },
      [`GET /api/v1/campaigns/${CAMPAIGN}`]: {
        status: 200,
        body: { id: CAMPAIGN, name: 'A Coroa Partida', system: { id: SYSTEM, name: 'D&D', edition: null, description: null, version: 0 }, archived: false, version: 0 },
      },
      [`GET /api/v1/systems/${SYSTEM}/record-types?limit=50`]: { status: 200, body: { items: [spell, talent], total: 2 } },
    });

    const html = inShell(await RulesConversationPage({ params: params(RULES_ID) }));

    expect(calls(server)).toEqual(expect.arrayContaining([`GET /api/v1/campaigns/${CAMPAIGN}`, `GET /api/v1/systems/${SYSTEM}/record-types?limit=50`]));
    expect(html).toContain('Ataque Poderoso');
    expect(html).toMatch(/>Talento<\/span>/);
    expect(html).not.toMatch(/>talento</);
  });

  it('Story 5.4 part A: an opened conversation offers the system\'s core and approved types on a draft\'s card and names a saved draft\'s artifact', async () => {
    const SYSTEM = '0190a0b0-0000-7000-8000-000000000001';
    const ARTIFACT = '0190a0b0-0000-7000-8000-000000000903';
    const talent = { id: '0190a0b0-0000-7000-8000-000000000608', name: 'Talento', core: null, key: 'talento', origin: { kind: 'proposal' }, records: 3, version: 0 };
    const encounter = { id: '0190a0b0-0000-7000-8000-000000000606', name: 'encounter', core: 'encounter', key: 'encounter', origin: { kind: 'core' }, records: 0, version: 0 };
    const draft = (id: string, saving: Record<string, unknown>) => ({
      id,
      question: 'Um encontro para a cripta',
      language: 'pt-BR',
      createdAt: '2026-11-26T12:00:00Z',
      events: [
        { sequence: 1, type: 'delta', data: { text: '## Cripta' } },
        { sequence: 2, type: 'citation', data: { passageId: PASSAGE, offset: 9 } },
        {
          sequence: 3,
          type: 'done',
          data: { ...STORED.events[2]!.data, proposal: { name: 'Emboscada na Cripta', recordType: 'encounter' } },
        },
      ],
      bookmarked: false,
      kind: 'draft',
      saving,
    });
    await useBackend({
      'GET /api/v1/conversations/current': CURRENT,
      [REVIEW]: NO_REVIEW,
      [`GET /api/v1/conversations/${FIRST}`]: { status: 200, body: { id: FIRST, campaignId: CAMPAIGN, area: 'questions', name: 'Cripta', version: 0 } },
      [`GET /api/v1/conversations/${FIRST}/turns`]: {
        status: 200,
        body: { items: [draft(TURN, { state: 'offered', artifactId: null }), draft(SECOND, { state: 'saved', artifactId: ARTIFACT })] },
      },
      [`GET /api/v1/campaigns/${CAMPAIGN}`]: {
        status: 200,
        body: { id: CAMPAIGN, name: 'A Coroa Partida', system: { id: SYSTEM, name: 'D&D', edition: null, description: null, version: 0 }, archived: false, version: 0 },
      },
      [`GET /api/v1/systems/${SYSTEM}/record-types?limit=50`]: { status: 200, body: { items: [encounter, talent], total: 2 } },
      [`GET /api/v1/campaigns/${CAMPAIGN}/artifacts/${ARTIFACT}`]: { status: 200, body: { id: ARTIFACT, name: 'Emboscada Salva' } },
    });

    const html = inShell(await QuestionsConversationPage({ params: params(FIRST) }));

    // The offered draft's card: every core and approved type, by the names this interface gives them.
    const options = [...html.matchAll(/<option value="([^"]*)"[^>]*>([^<]*)<\/option>/g)].map((match) => `${match[1]}=${match[2]}`);
    expect(options).toEqual(['=Escolha um tipo', `encounter=${ptBR.systems.recordTypes.encounter}`, 'talento=Talento']);
    // The saved draft's link names its artifact, read with the page.
    expect(html).toContain('Salvo como artefato: «Emboscada Salva»');
    expect(linkTo(html, `/campaigns/${CAMPAIGN}/artifacts/${ARTIFACT}`)).not.toBe('');
  });

  it('a conversation of the other area opens under its own address; another account\'s is "Não encontrado."', async () => {
    await useBackend({
      'GET /api/v1/conversations/current': CURRENT,
      [REVIEW]: NO_REVIEW,
      [`GET /api/v1/conversations/${RULES_ID}`]: { status: 200, body: RULES },
      [`GET /api/v1/conversations/${RULES_ID}/turns`]: { status: 200, body: { items: [] } },
      [`GET /api/v1/conversations/${FIRST}`]: problem(404, 'request.not_found'),
      [`GET /api/v1/conversations/${FIRST}/turns`]: problem(404, 'request.not_found'),
    });
    expect(await thrownDigest(async () => QuestionsConversationPage({ params: params(RULES_ID) }))).toMatch(
      new RegExp(`^NEXT_REDIRECT;[a-z]+;/rules/${RULES_ID};`),
    );
    expect(await thrownDigest(async () => RulesConversationPage({ params: params(FIRST) }))).toMatch(/NEXT_HTTP_ERROR_FALLBACK;404/);
    const count = backend!.calls.length;
    expect(await thrownDigest(async () => RulesConversationPage({ params: params('../me') }))).toMatch(/NEXT_HTTP_ERROR_FALLBACK;404/);
    expect(backend!.calls).toHaveLength(count);
  });
});

describe('an opened conversation at a saved answer (Story 3.12)', () => {
  const routes = () => ({
    'GET /api/v1/conversations/current': CURRENT,
    [REVIEW]: NO_REVIEW,
    [`GET /api/v1/conversations/${RULES_ID}`]: { status: 200, body: RULES },
    [`GET /api/v1/conversations/${RULES_ID}/turns`]: { status: 200, body: { items: [{ ...STORED, bookmarked: true }] } },
  });

  it('`?turn=` marks that turn as the one to open at; anything that is not an id is ignored', async () => {
    await useBackend(routes());
    const html = inShell(await RulesConversationPage({ params: params(RULES_ID), searchParams: Promise.resolve({ turn: TURN }) }));
    expect(html).toMatch(new RegExp(`<li id="turn-${TURN}"[^>]*tabindex="-1"`));

    for (const turn of ['nope', '../me', [TURN, TURN]]) {
      const ignored = inShell(await RulesConversationPage({ params: params(RULES_ID), searchParams: Promise.resolve({ turn }) }));
      expect(ignored).toContain(`id="turn-${TURN}"`);
      expect(ignored).not.toContain('tabindex="-1"');
    }
  });

  it('a conversation of the other area opens under its own address, keeping `?turn=`', async () => {
    await useBackend(routes());
    expect(
      await thrownDigest(async () => QuestionsConversationPage({ params: params(RULES_ID), searchParams: Promise.resolve({ turn: TURN }) })),
    ).toMatch(new RegExp(`^NEXT_REDIRECT;[a-z]+;/rules/${RULES_ID}\\?turn=${TURN};`));
    expect(
      await thrownDigest(async () => QuestionsConversationPage({ params: params(RULES_ID), searchParams: Promise.resolve({ turn: 'nope' }) })),
    ).toMatch(new RegExp(`^NEXT_REDIRECT;[a-z]+;/rules/${RULES_ID};`));
  });
});

describe('rename a conversation (Story 3.10)', () => {
  it('the rename page holds the name and the version, with the way back to the conversation', async () => {
    await useBackend({ [`GET /api/v1/conversations/${RULES_ID}`]: { status: 200, body: RULES } });

    const html = renderToStaticMarkup(await RenameRulesConversationPage({ params: params(RULES_ID) }));

    expect(html).toContain(ptBR.conversations.form.renameTitle);
    expect(html).toMatch(/<input[^>]*name="name"[^>]*value="Fabricar itens"|<input[^>]*value="Fabricar itens"[^>]*name="name"/);
    expect(html).toContain('<input type="hidden" name="version" value="3"/>');
    expect(html).toContain(`<input type="hidden" name="id" value="${RULES_ID}"/>`);
    expect(html).toContain(`href="/rules/${RULES_ID}"`);
    expect(solids(html)).toEqual([ptBR.conversations.form.save]);
    expect(html).not.toContain('<select');
  });

  it('saves on the version read, names the conversation in a toast and opens it; a stale version or a bad name is said', async () => {
    const routes: Record<string, { status: number; body: unknown }> = {
      [`PATCH /api/v1/conversations/${RULES_ID}`]: { status: 200, body: { ...RULES, name: 'Viagem ao norte', version: 4 } },
    };
    const server = await useBackend(routes);
    const previous = { values: { name: 'Fabricar itens', systemId: '' }, version: 3, error: null, field: null, stale: false };
    const typed = { id: RULES_ID, version: '3', name: 'Viagem ao norte' };

    expect(await thrownDigest(() => renameConversationAction(previous, form(typed)))).toMatch(new RegExp(`^NEXT_REDIRECT;[a-z]+;/rules/${RULES_ID};`));
    expect(JSON.parse(server.calls[0]!.body)).toEqual({ version: 3, name: 'Viagem ao norte' });
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
    const [name, value] = setCookie.mock.calls[0] as [string, string];
    expect(name).toBe(FLASH_COOKIE);
    expect(flashFrom(value)).toEqual({ status: 'success', message: 'Conversa renomeada para «Viagem ao norte».' });

    // Matrix row "Stale rename": the form shows the current name and version, and says it changed elsewhere.
    routes[`PATCH /api/v1/conversations/${RULES_ID}`] = problem(409, 'request.stale_version');
    routes[`GET /api/v1/conversations/${RULES_ID}`] = { status: 200, body: { ...RULES, name: 'Outro nome', version: 5 } };
    expect(await renameConversationAction(previous, form(typed))).toEqual({
      values: { name: 'Outro nome', systemId: '' },
      version: 5,
      error: ptBR.conversations.form.stale,
      field: null,
      stale: true,
    });
    // Matrix row "Bad name": beside the field, with the limits, in the interface's language.
    routes[`PATCH /api/v1/conversations/${RULES_ID}`] = problem(400, 'request.conversation_name_invalid', { min: 1, max: 120 });
    cookieJar['__Host-gmshield-lang'] = 'en';
    expect(await renameConversationAction(previous, form({ ...typed, name: '' }))).toMatchObject({
      error: 'The name needs 1 to 120 characters.',
      field: 'name',
      version: 3,
      values: { name: '' },
    });
    const count = server.calls.length;
    for (const fields of [{ ...typed, id: '../me' }, { ...typed, version: '-1' }, { ...typed, version: '9'.repeat(16) }]) {
      expect((await renameConversationAction(previous, form(fields))).error).toBe('The request is not valid.');
    }
    expect(server.calls).toHaveLength(count);
  });
});

describe('delete a conversation (Story 3.10 part B)', () => {
  it('an opened conversation has "Excluir" after "Renomear", outlined in danger, its dialog naming the questions read with the page', async () => {
    const routes: Record<string, { status: number; body: unknown }> = {
      'GET /api/v1/conversations/current': CURRENT,
      [REVIEW]: NO_REVIEW,
      [`GET /api/v1/conversations/${RULES_ID}`]: { status: 200, body: RULES },
      [`GET /api/v1/conversations/${RULES_ID}/turns`]: { status: 200, body: { items: [STORED] } },
      [`GET /api/v1/conversations/${RULES_ID}/deletion`]: { status: 200, body: { questions: 2, artifacts: [] } },
    };
    const server = await useBackend(routes);
    for (const [language, messages] of [['pt-BR', ptBR], ['en', en]] as const) {
      cookieJar['__Host-gmshield-lang'] = language;
      const html = inShell(await RulesConversationPage({ params: params(RULES_ID) }));
      expect(html).toMatch(new RegExp(`<button[^>]*data-variant="danger"[^>]*>${messages.conversations.delete.action}</button>`));
      expect(html).toMatch(new RegExp(`<button[^>]*aria-haspopup="dialog"[^>]*>${messages.conversations.delete.action}</button>`));
      expect(html.indexOf(`>${messages.conversation.rename}</a>`)).toBeLessThan(html.indexOf(`>${messages.conversations.delete.action}</button>`));
      // The dialog is rendered closed, already naming the count of this conversation.
      expect(html).toContain(messages.conversations.delete.title);
      expect(html).toContain(language === 'en' ? 'Going with it: 2 questions and their answers.' : 'Vão junto: 2 perguntas e suas respostas.');
      expect(html).toContain(`>${messages.conversations.delete.confirm}</button>`);
      expect(solids(html)).not.toContain(messages.conversations.delete.action);
    }
    expect(server.calls.find((call) => call.url === `/api/v1/conversations/${RULES_ID}/deletion`)!.headers['x-session-token']).toBe(SESSION);

    // A count that cannot be read leaves the dialog in words.
    cookieJar['__Host-gmshield-lang'] = 'pt-BR';
    routes[`GET /api/v1/conversations/${RULES_ID}/deletion`] = problem(503, 'backend.unavailable');
    const html = inShell(await RulesConversationPage({ params: params(RULES_ID) }));
    expect(html).toContain('Vão junto: as perguntas desta conversa e suas respostas. Isso não pode ser desfeito.');
    expect(html).toMatch(/<button[^>]*data-variant="danger"[^>]*>Excluir<\/button>/);
  });

  it('a new conversation has no "Excluir" until its first question gives it an id, and is given the delete for then', async () => {
    await useBackend({
      'GET /api/v1/conversations/current': CURRENT,
      [REVIEW]: NO_REVIEW,
      [`GET /api/v1/conversations/${RULES_ID}`]: { status: 200, body: RULES },
      [`GET /api/v1/conversations/${RULES_ID}/turns`]: { status: 200, body: { items: [STORED] } },
    });
    const page = await NewQuestionsConversationPage();
    const html = inShell(page);
    expect(html).not.toContain(`>${ptBR.conversations.delete.action}</button>`);
    expect(html).not.toContain(ptBR.conversations.delete.title);
    // The Server Action is handed over now, for "Excluir" once the first question made the conversation.
    expect((page as { props: { deleteAction?: unknown } }).props.deleteAction).toBe(deleteConversationAction);
    const rules = await NewRulesConversationPage();
    expect((rules as { props: { deleteAction?: unknown } }).props.deleteAction).toBe(deleteConversationAction);
    const opened = await RulesConversationPage({ params: params(RULES_ID) });
    expect((opened as { props: { deleteAction?: unknown } }).props.deleteAction).toBe(deleteConversationAction);
  });

  it('"Excluir conversa" deletes it, names it in a toast, revalidates the layout and opens its area; a refusal comes back as its text', async () => {
    const routes: Record<string, { status: number; body?: unknown }> = {
      [`GET /api/v1/conversations/${RULES_ID}`]: { status: 200, body: RULES },
      [`POST /api/v1/conversations/${RULES_ID}/deletion`]: { status: 202 },
    };
    const server = await useBackend(routes);

    expect(await thrownDigest(() => deleteConversationAction({ error: null }, form({ id: RULES_ID })))).toMatch(/^NEXT_REDIRECT;[a-z]+;\/rules;/);
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
    const [name, value] = setCookie.mock.calls[0] as [string, string];
    expect(name).toBe(FLASH_COOKIE);
    expect(flashFrom(value)).toEqual({ status: 'success', message: 'Conversa «Fabricar itens» excluída.' });
    // Story 5.4 part B: one request, with the ticked artifacts (none here: all kept).
    const deleted = server.calls.find((call) => call.method === 'POST')!;
    expect(deleted.url).toBe(`/api/v1/conversations/${RULES_ID}/deletion`);
    expect(deleted.headers['x-session-token']).toBe(SESSION);
    expect(JSON.parse(deleted.body)).toEqual({ artifactIds: [] });
    revalidatePath.mockClear();
    setCookie.mockClear();

    // A questions conversation opens Consultas, and the toast is in the interface's language.
    routes[`GET /api/v1/conversations/${FIRST}`] = { status: 200, body: { ...RULES, id: FIRST, area: 'questions', name: 'Fire Bolt' } };
    routes[`POST /api/v1/conversations/${FIRST}/deletion`] = { status: 202 };
    cookieJar['__Host-gmshield-lang'] = 'en';
    expect(await thrownDigest(() => deleteConversationAction({ error: null }, form({ id: FIRST })))).toMatch(/^NEXT_REDIRECT;[a-z]+;\/questions;/);
    expect(flashFrom((setCookie.mock.calls[0] as [string, string])[1])).toEqual({ status: 'success', message: 'Conversation «Fire Bolt» deleted.' });
    revalidatePath.mockClear();

    // Matrix row "Twice": already deleting, or another owner's: the read refuses, and nothing is deleted.
    cookieJar['__Host-gmshield-lang'] = 'pt-BR';
    routes[`GET /api/v1/conversations/${RULES_ID}`] = problem(404, 'request.not_found');
    const before = server.calls.filter((call) => call.method === 'POST').length;
    expect(await deleteConversationAction({ error: null }, form({ id: RULES_ID }))).toEqual({ error: 'Não encontrado.' });
    expect(server.calls.filter((call) => call.method === 'POST')).toHaveLength(before);
    // Gone between the read and the delete.
    routes[`GET /api/v1/conversations/${RULES_ID}`] = { status: 200, body: RULES };
    routes[`POST /api/v1/conversations/${RULES_ID}/deletion`] = problem(404, 'request.not_found');
    expect(await deleteConversationAction({ error: null }, form({ id: RULES_ID }))).toEqual({ error: 'Não encontrado.' });
    expect(revalidatePath).not.toHaveBeenCalled();
    // A malformed id never reaches the backend.
    const count = server.calls.length;
    for (const fields of [{ id: '../x' }, {}] as Record<string, string>[]) {
      expect(await deleteConversationAction({ error: null }, form(fields))).toEqual({ error: 'O pedido não é válido.' });
    }
    expect(server.calls).toHaveLength(count);
  });

  it('Story 5.4 part B: the page hands the dialog the saved artifacts, oldest first, each named with its record type', async () => {
    const SYSTEM = '0190a0b0-0000-7000-8000-000000000001';
    const talent = { id: '0190a0b0-0000-7000-8000-000000000608', name: 'Talento', core: null, key: 'talento', origin: { kind: 'proposal' }, records: 3, version: 0 };
    await useBackend({
      'GET /api/v1/conversations/current': CURRENT,
      [REVIEW]: NO_REVIEW,
      [`GET /api/v1/conversations/${RULES_ID}`]: { status: 200, body: RULES },
      [`GET /api/v1/conversations/${RULES_ID}/turns`]: { status: 200, body: { items: [STORED] } },
      [`GET /api/v1/conversations/${RULES_ID}/deletion`]: {
        status: 200,
        body: {
          questions: 2,
          artifacts: [
            { id: ARTIFACT_A, name: 'Cripta', recordType: 'encounter' },
            { id: ARTIFACT_B, name: 'Golpe', recordType: 'talento' },
          ],
        },
      },
      [`GET /api/v1/campaigns/${CAMPAIGN}`]: {
        status: 200,
        body: { id: CAMPAIGN, name: 'A Coroa Partida', system: { id: SYSTEM, name: 'D&D', edition: null, description: null, version: 0 }, archived: false, version: 0 },
      },
      [`GET /api/v1/systems/${SYSTEM}/record-types?limit=50`]: { status: 200, body: { items: [talent], total: 1 } },
    });

    const page = await RulesConversationPage({ params: params(RULES_ID) });

    expect((page as { props: { deleteArtifacts?: unknown } }).props.deleteArtifacts).toEqual([
      { id: ARTIFACT_A, name: 'Cripta', typeLabel: ptBR.systems.recordTypes.encounter },
      { id: ARTIFACT_B, name: 'Golpe', typeLabel: 'Talento' },
    ]);
    // The dialog is rendered closed with its list, nothing ticked, "Manter todos" pressed.
    const html = inShell(page);
    expect(html).toContain(ptBR.conversations.delete.artifactsLegend);
    expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*>Manter todos<\/button>/);
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*aria-label="Cripta, Encontro"/);
    expect(html).not.toMatch(/<input[^>]*type="checkbox"[^>]*checked/);
  });

  it('Story 5.4 part B: "Excluir conversa" sends the ticked ids in the one request; a malformed id or too many never reach the backend', async () => {
    const routes: Record<string, { status: number; body?: unknown }> = {
      [`GET /api/v1/conversations/${RULES_ID}`]: { status: 200, body: RULES },
      [`POST /api/v1/conversations/${RULES_ID}/deletion`]: { status: 202 },
    };
    const server = await useBackend(routes);
    const ticked = (ids: string[]) => {
      const data = form({ id: RULES_ID });
      for (const id of ids) {
        data.append('artifactIds', id);
      }
      return data;
    };

    expect(await thrownDigest(() => deleteConversationAction({ error: null }, ticked([ARTIFACT_A, ARTIFACT_B, ARTIFACT_A])))).toMatch(
      /^NEXT_REDIRECT;[a-z]+;\/rules;/,
    );
    const posted = server.calls.find((call) => call.method === 'POST')!;
    expect(JSON.parse(posted.body)).toEqual({ artifactIds: [ARTIFACT_A, ARTIFACT_B] });
    expect(flashFrom((setCookie.mock.calls[0] as [string, string])[1])).toEqual({ status: 'success', message: 'Conversa «Fabricar itens» excluída.' });

    // Matrix row "Bad body": refused before the backend, as 3.10's refusal.
    const count = server.calls.length;
    const many = Array.from({ length: 65 }, (_, index) => `0190a0b0-0000-7000-8000-${String(index).padStart(12, '0')}`);
    for (const ids of [['nope'], [ARTIFACT_A, '../x'], many]) {
      expect(await deleteConversationAction({ error: null }, ticked(ids))).toEqual({ error: 'O pedido não é válido.' });
    }
    expect(server.calls).toHaveLength(count);
    // The backend's own refusal on artifactIds comes back as its text.
    routes[`POST /api/v1/conversations/${RULES_ID}/deletion`] = problem(400, 'request.invalid', { max: 64 });
    expect(await deleteConversationAction({ error: null }, ticked([ARTIFACT_A]))).toEqual({ error: 'O pedido não é válido.' });
  });
});
