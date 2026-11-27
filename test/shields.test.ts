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
/** What an action did, in order: the toast, the revalidation (a redirect is thrown last). */
const steps: string[] = [];
const revalidatePath = vi.fn((...args: unknown[]) => steps.push(`revalidate ${args.join(' ')}`));
vi.mock('next/cache', () => ({ refresh: () => steps.push('refresh'), revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));
const flashed = vi.fn((...args: unknown[]) => steps.push(`flash ${args.join(' ')}`));
vi.mock('@/server/flash', () => ({ flash: async (...args: unknown[]) => flashed(...args) }));

const { renderToStaticMarkup } = await import('react-dom/server');
const { default: CampaignPage } = await import('@/app/(signed-in)/campaigns/[id]/page');
const { default: NewShieldPage } = await import('@/app/(signed-in)/campaigns/[id]/shields/new/page');
const { default: ShieldPage } = await import('@/app/(signed-in)/campaigns/[id]/shields/[shieldId]/page');
const { default: RenameShieldPage } = await import('@/app/(signed-in)/campaigns/[id]/shields/[shieldId]/edit/page');
const { default: NewNotePage } = await import('@/app/(signed-in)/campaigns/[id]/shields/[shieldId]/notes/new/page');
const { createNoteAction, createShieldAction, deleteShieldAction, renameShieldAction } = await import('@/app/(signed-in)/campaigns/[id]/shields/actions');
const ptBR = (await import('@/messages/pt-BR.json')).default;
const en = (await import('@/messages/en.json')).default;
const { startScripted } = await import('./support/servers');
type Scripted = Awaited<ReturnType<typeof startScripted>>;
type ShieldFormState = import('@/app/(signed-in)/campaigns/[id]/shields/form-state').ShieldFormState;
const { NO_NOTE } = await import('@/app/(signed-in)/campaigns/[id]/shields/form-state');

const SESSION = 'sessionTokenBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const CREDENTIAL = 'configured-service-credential-0123456789';
const CAMPAIGN = '0190a0b0-0000-7000-8000-000000000002';
const FIRST_ID = '0190a0b0-0000-7000-8000-000000000a01';
const COMBAT_ID = '0190a0b0-0000-7000-8000-000000000a02';
const SYSTEM = { id: '0190a0b0-0000-7000-8000-000000000001', name: 'Sistema sem nome', edition: null, description: null, version: 0 };
const STARTER = { id: CAMPAIGN, name: 'Primeira campanha', system: SYSTEM, archived: false, version: 0 };
const FIRST = { id: FIRST_ID, name: null, version: 0 };
const COMBAT = { id: COMBAT_ID, name: 'Combate', version: 0 };
const SHIELDS = `/api/v1/campaigns/${CAMPAIGN}/shields`;
const NEW: ShieldFormState = { values: { name: '' }, version: null, error: null, field: null, stale: false };

let backend: Scripted | undefined;
async function useBackend(routes: Parameters<typeof startScripted>[0]): Promise<Scripted> {
  backend = await startScripted(routes);
  vi.stubEnv('GMSHIELD_MODE', '');
  vi.stubEnv('GMSHIELD_BACKEND_URL', backend.url);
  vi.stubEnv('GMSHIELD_FRONTEND_CREDENTIAL', CREDENTIAL);
  return backend;
}

function problem(status: number, code: string, params: Record<string, number | string> = {}) {
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

const calls = (server: Scripted) => server.calls.map((call) => `${call.method} ${call.url}`);
/** The solid pills of a page: links or buttons whose variant is solid. */
const solids = (html: string) => [...html.matchAll(/<(a|button)[^>]*data-variant="solid"[^>]*>(.*?)<\/\1>/g)].map((match) => match[2]);
/** The opening tag of the link to `href`, whatever its attributes' order; '' when there is none. */
const linkTo = (html: string, href: string) => [...html.matchAll(/<a\b[^>]*>/g)].map((match) => match[0]).find((tag) => tag.includes(`href="${href}"`)) ?? '';
const LANGUAGES = [['pt-BR', ptBR], ['en', en]] as const;
/** A text as React writes it into markup (an apostrophe escaped). */
const escaped = (text: string) => text.replace(/'/g, '&#x27;');

beforeEach(() => {
  cookieJar = { '__Host-gmshield-session': `${SESSION}.9999999999` };
  steps.length = 0;
  revalidatePath.mockClear();
  flashed.mockClear();
});

afterEach(async () => {
  await backend?.close();
  backend = undefined;
  vi.unstubAllEnvs();
});

describe("a campaign's Shields tab (Story 6.1)", () => {
  it('lists the Shields oldest first, the first one under its default name, each opening its screen, under one solid "Novo escudo"', async () => {
    const server = await useBackend({
      [`GET /api/v1/campaigns/${CAMPAIGN}`]: { status: 200, body: STARTER },
      [`GET ${SHIELDS}?limit=10`]: { status: 200, body: { items: [FIRST, COMBAT], total: 2 } },
    });
    for (const [language, messages] of LANGUAGES) {
      cookieJar['__Host-gmshield-lang'] = language;
      const html = renderToStaticMarkup(await CampaignPage({ params: Promise.resolve({ id: CAMPAIGN }), searchParams: Promise.resolve({ tab: 'shields' }) }));

      // The tab comes after "Escopo", and is the current one.
      const tabs = [...html.matchAll(/<a[^>]*href="\/campaigns\/[^"?]+\?tab=(\w+)"[^>]*>/g)].map((match) => match[1]);
      expect(tabs.slice(0, 5)).toEqual(['overview', 'scope', 'shields', 'conversations', 'artifacts']);
      expect(linkTo(html, `/campaigns/${CAMPAIGN}?tab=shields`)).toContain('aria-current="page"');
      expect(html).toContain(`>${messages.campaigns.page.shields}<`);
      expect(html).toContain(`aria-label="${escaped(messages.shields.list)}"`);
      expect(html).toContain(escaped(messages.shields.defaultName));
      expect(html.indexOf('Combate')).toBeGreaterThan(html.indexOf(escaped(messages.shields.defaultName)));
      expect(linkTo(html, `/campaigns/${CAMPAIGN}/shields/${FIRST_ID}`)).not.toBe('');
      expect(linkTo(html, `/campaigns/${CAMPAIGN}/shields/${COMBAT_ID}`)).not.toBe('');
      expect(solids(html)).toContain(messages.shields.new);
      expect(linkTo(html, `/campaigns/${CAMPAIGN}/shields/new`)).toContain('data-variant="solid"');
    }
    expect(calls(server)).toContain(`GET ${SHIELDS}?limit=10`);
  });

  it('is paged: a later page is asked by its offset and the pager links keep the tab', async () => {
    const many = Array.from({ length: 10 }, (_, index) => ({ id: `0190a0b0-0000-7000-8000-00000000b0${String(index).padStart(2, '0')}`, name: `Escudo ${index + 11}`, version: 0 }));
    const server = await useBackend({
      [`GET /api/v1/campaigns/${CAMPAIGN}`]: { status: 200, body: STARTER },
      [`GET ${SHIELDS}?limit=10&offset=10`]: { status: 200, body: { items: many, total: 23 } },
    });

    const html = renderToStaticMarkup(
      await CampaignPage({ params: Promise.resolve({ id: CAMPAIGN }), searchParams: Promise.resolve({ tab: 'shields', page: '2' }) }),
    );

    expect(calls(server)).toContain(`GET ${SHIELDS}?limit=10&offset=10`);
    expect(html).toContain('Escudo 11');
    expect(html).toContain(`href="/campaigns/${CAMPAIGN}?tab=shields&amp;page=3"`);
  });

  it('says why when the Shields cannot be read', async () => {
    await useBackend({
      [`GET /api/v1/campaigns/${CAMPAIGN}`]: { status: 200, body: STARTER },
      [`GET ${SHIELDS}?limit=10`]: problem(503, 'server.unavailable'),
    });

    const html = renderToStaticMarkup(await CampaignPage({ params: Promise.resolve({ id: CAMPAIGN }), searchParams: Promise.resolve({ tab: 'shields' }) }));

    expect(html).toContain('data-status="danger"');
    expect(html).toContain(ptBR.errors.codes.server.unavailable);
    expect(html).not.toContain(ptBR.shields.new);
  });
});

describe("a Shield's screen and its forms (Story 6.1)", () => {
  it('names the unnamed first Shield by its default name, leads back to the tab, offers "Renomear" and says it has no notes yet', async () => {
    await useBackend({
      [`GET ${SHIELDS}/${FIRST_ID}`]: { status: 200, body: FIRST },
      [`GET ${SHIELDS}/${FIRST_ID}/notes?limit=10`]: { status: 200, body: { items: [], total: 0 } },
    });
    for (const [language, messages] of LANGUAGES) {
      cookieJar['__Host-gmshield-lang'] = language;
      const html = renderToStaticMarkup(await ShieldPage({ params: Promise.resolve({ id: CAMPAIGN, shieldId: FIRST_ID }) }));

      expect(html).toMatch(new RegExp(`<h1[^>]*>${escaped(messages.shields.defaultName)}</h1>`));
      expect(linkTo(html, `/campaigns/${CAMPAIGN}?tab=shields`)).not.toBe('');
      expect(html).toContain(`>${messages.campaigns.page.shields}</a>`);
      expect(html).toMatch(new RegExp(`<a[^>]*href="/campaigns/${CAMPAIGN}/shields/${FIRST_ID}/edit"[^>]*>${messages.shields.rename}</a>`));
      expect(html).toContain(messages.shields.empty);
    }
  });

  it('shows a named Shield by its name', async () => {
    await useBackend({ [`GET ${SHIELDS}/${COMBAT_ID}`]: { status: 200, body: COMBAT } });

    const html = renderToStaticMarkup(await ShieldPage({ params: Promise.resolve({ id: CAMPAIGN, shieldId: COMBAT_ID }) }));

    expect(html).toMatch(/<h1[^>]*>Combate<\/h1>/);
    expect(html).not.toContain('Escudo do Mestre');
  });

  it('shows the single "Não encontrado." page for a Shield the backend does not find, on the screen and the rename page', async () => {
    await useBackend({ [`GET ${SHIELDS}/${COMBAT_ID}`]: problem(404, 'request.not_found') });

    expect(await thrownDigest(async () => ShieldPage({ params: Promise.resolve({ id: CAMPAIGN, shieldId: COMBAT_ID }) }))).toMatch(/NEXT_HTTP_ERROR_FALLBACK;404/);
    expect(await thrownDigest(async () => RenameShieldPage({ params: Promise.resolve({ id: CAMPAIGN, shieldId: COMBAT_ID }) }))).toMatch(
      /NEXT_HTTP_ERROR_FALLBACK;404/,
    );
  });

  it('starts "Novo escudo" empty under the way back to the tab, and the rename from the stored name and its version', async () => {
    await useBackend({
      [`GET /api/v1/campaigns/${CAMPAIGN}`]: { status: 200, body: STARTER },
      [`GET ${SHIELDS}/${FIRST_ID}`]: { status: 200, body: { ...FIRST, version: 3 } },
    });
    for (const [language, messages] of LANGUAGES) {
      cookieJar['__Host-gmshield-lang'] = language;
      const created = renderToStaticMarkup(await NewShieldPage({ params: Promise.resolve({ id: CAMPAIGN }) }));
      expect(created).toContain(`<h1`);
      expect(created).toContain(messages.shields.form.newTitle);
      expect(created).toContain(`name="campaign" value="${CAMPAIGN}"`);
      expect(created).not.toContain('name="version"');
      expect(solids(created)).toEqual([messages.shields.form.create]);
      expect(created).toMatch(new RegExp(`<a[^>]*href="/campaigns/${CAMPAIGN}\\?tab=shields"[^>]*>${messages.shields.form.cancel}</a>`));

      const renamed = renderToStaticMarkup(await RenameShieldPage({ params: Promise.resolve({ id: CAMPAIGN, shieldId: FIRST_ID }) }));
      expect(renamed).toContain(messages.shields.form.renameTitle);
      // The unnamed Shield's field starts empty, its default name only the placeholder.
      expect(renamed).toMatch(new RegExp(`<input[^>]*placeholder="${escaped(messages.shields.defaultName)}"`));
      expect(renamed).toMatch(/<input[^>]*name="name" value=""\/>/);
      expect(renamed).toContain(`name="id" value="${FIRST_ID}"`);
      expect(renamed).toContain('name="version" value="3"');
      expect(solids(renamed)).toEqual([messages.shields.form.save]);
      expect(renamed).not.toMatch(/<[^>]+\sstyle=/);
    }
  });
});

describe("a Shield's deletion (Story 6.1 part B)", () => {
  it('puts a danger "Excluir" last in the header, after "Renomear", with the preview read alongside the Shield', async () => {
    const server = await useBackend({
      [`GET ${SHIELDS}/${COMBAT_ID}`]: { status: 200, body: COMBAT },
      [`GET ${SHIELDS}/${COMBAT_ID}/deletion`]: { status: 200, body: { notes: 0, rolls: 0, last: false } },
    });
    for (const [language, messages] of LANGUAGES) {
      cookieJar['__Host-gmshield-lang'] = language;
      const html = renderToStaticMarkup(await ShieldPage({ params: Promise.resolve({ id: CAMPAIGN, shieldId: COMBAT_ID }) }));

      const pill = html.match(new RegExp(`<button[^>]*>(?:(?!</button>).)*${messages.shields.delete.action}(?:(?!</button>).)*</button>`))?.[0] ?? '';
      expect(pill).toContain('data-variant="danger"');
      expect(pill).toContain('aria-haspopup="dialog"');
      expect(html.indexOf(pill)).toBeGreaterThan(html.indexOf(`>${messages.shields.rename}</a>`));
      // The dialog is closed until the pill is pressed; its text is there for it.
      expect(html).toContain(escaped(messages.shields.delete.empty));
    }
    expect(calls(server)).toContain(`GET ${SHIELDS}/${COMBAT_ID}/deletion`);
  });

  it('Story 6.2 part B: the dialog names how many notes go, as the preview counts them', async () => {
    await useBackend({
      [`GET ${SHIELDS}/${COMBAT_ID}`]: { status: 200, body: COMBAT },
      [`GET ${SHIELDS}/${COMBAT_ID}/deletion`]: { status: 200, body: { notes: 3, rolls: 0, last: false } },
    });
    for (const [language, messages] of LANGUAGES) {
      cookieJar['__Host-gmshield-lang'] = language;
      const html = renderToStaticMarkup(await ShieldPage({ params: Promise.resolve({ id: CAMPAIGN, shieldId: COMBAT_ID }) }));

      const consequence = messages.shields.delete.consequence
        .replace('{notes}', messages.shields.delete.notesOther.replace('{count}', '3'))
        .replace('{rolls}', messages.shields.delete.rollsOther.replace('{count}', '0'));
      expect(html).toContain(escaped(consequence));
      expect(html).not.toContain(escaped(messages.shields.delete.empty));
    }
  });

  it('still offers the dialog when the preview cannot be read, naming what goes in words', async () => {
    await useBackend({
      [`GET ${SHIELDS}/${COMBAT_ID}`]: { status: 200, body: COMBAT },
      [`GET ${SHIELDS}/${COMBAT_ID}/deletion`]: problem(503, 'server.unavailable'),
    });

    const html = renderToStaticMarkup(await ShieldPage({ params: Promise.resolve({ id: CAMPAIGN, shieldId: COMBAT_ID }) }));

    const pill = html.match(new RegExp(`<button[^>]*>(?:(?!</button>).)*${ptBR.shields.delete.action}(?:(?!</button>).)*</button>`))?.[0] ?? '';
    expect(pill).toContain('aria-haspopup="dialog"');
    expect(html).toContain(escaped(ptBR.shields.delete.unknown));
    expect(html).not.toContain(escaped(ptBR.shields.delete.empty));
  });

  it('offers no dialog for the campaign\'s only Shield', async () => {
    await useBackend({
      [`GET ${SHIELDS}/${FIRST_ID}`]: { status: 200, body: FIRST },
      [`GET ${SHIELDS}/${FIRST_ID}/deletion`]: { status: 200, body: { notes: 0, rolls: 0, last: true } },
    });

    const html = renderToStaticMarkup(await ShieldPage({ params: Promise.resolve({ id: CAMPAIGN, shieldId: FIRST_ID }) }));

    expect(html).toContain(`>${ptBR.shields.delete.action}<`);
    expect(html).not.toContain('aria-haspopup="dialog"');
    expect(html).not.toContain('<dialog');
  });

  it('deletes (202): the ids go to the backend, then the toast, the layout revalidated, and the campaign\'s Shields tab', async () => {
    // Story 6.2 part B: the recorded deletion answers 202; a backend before 1.58.0 answered 204, read the same way.
    const server = await useBackend({ [`DELETE ${SHIELDS}/${COMBAT_ID}`]: { status: 202 } });

    const digest = await thrownDigest(() => deleteShieldAction({ error: null }, form({ campaign: CAMPAIGN, id: COMBAT_ID })));

    expect(digest).toMatch(new RegExp(`^NEXT_REDIRECT;[a-z]+;/campaigns/${CAMPAIGN}\\?tab=shields;`));
    expect(calls(server)).toEqual([`DELETE ${SHIELDS}/${COMBAT_ID}`]);
    expect(server.calls[0]!.headers['x-session-token']).toBe(SESSION);
    expect(steps).toEqual([`flash success ${ptBR.feedback.shieldDeleted}`, 'revalidate / layout']);
    steps.length = 0;
    cookieJar['__Host-gmshield-lang'] = 'en';
    await thrownDigest(() => deleteShieldAction({ error: null }, form({ campaign: CAMPAIGN, id: COMBAT_ID })));
    expect(steps).toEqual(['flash success Shield deleted.', 'revalidate / layout']);
  });

  it('the last Shield refused meanwhile comes back as the reason, with no toast; another refusal as its text', async () => {
    const routes: Record<string, { status: number; body: unknown }> = {
      [`DELETE ${SHIELDS}/${FIRST_ID}`]: problem(409, 'request.last_shield'),
    };
    await useBackend(routes);

    expect(await deleteShieldAction({ error: null }, form({ campaign: CAMPAIGN, id: FIRST_ID }))).toEqual({
      error: 'Uma campanha precisa de pelo menos um escudo.',
    });
    // The screen's stale preview (not the last) is read again, so the next press says why without a dialog.
    expect(steps).toEqual(['revalidate / layout']);
    cookieJar['__Host-gmshield-lang'] = 'en';
    expect(await deleteShieldAction({ error: null }, form({ campaign: CAMPAIGN, id: FIRST_ID }))).toEqual({
      error: 'A campaign needs at least one Shield.',
    });
    steps.length = 0;
    revalidatePath.mockClear();
    routes[`DELETE ${SHIELDS}/${FIRST_ID}`] = problem(503, 'server.unavailable');
    expect(await deleteShieldAction({ error: null }, form({ campaign: CAMPAIGN, id: FIRST_ID }))).toEqual({
      error: en.errors.codes.server.unavailable,
    });
    expect(flashed).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('a Shield already gone moves on to the tab with no toast', async () => {
    await useBackend({ [`DELETE ${SHIELDS}/${COMBAT_ID}`]: problem(404, 'request.not_found') });

    const digest = await thrownDigest(() => deleteShieldAction({ error: null }, form({ campaign: CAMPAIGN, id: COMBAT_ID })));

    expect(digest).toMatch(new RegExp(`^NEXT_REDIRECT;[a-z]+;/campaigns/${CAMPAIGN}\\?tab=shields;`));
    expect(steps).toEqual(['revalidate / layout']);
  });

  it('never sends a malformed campaign or Shield to the backend', async () => {
    const server = await useBackend({});
    cookieJar['__Host-gmshield-lang'] = 'en';

    const malformed: Record<string, string>[] = [{ campaign: '../me', id: COMBAT_ID }, { campaign: CAMPAIGN, id: 'x' }, { campaign: CAMPAIGN }, {}];
    for (const fields of malformed) {
      expect(await deleteShieldAction({ error: null }, form(fields))).toEqual({ error: 'The request is not valid.' });
    }
    expect(server.calls).toHaveLength(0);
  });

  it('keeps the same keys in both languages, the last Shield\'s reason and its error code saying the same', () => {
    expect(Object.keys(en.shields.delete).sort()).toEqual(Object.keys(ptBR.shields.delete).sort());
    expect(ptBR.errors.codes.request.last_shield).toBe(ptBR.shields.delete.last);
    expect(en.errors.codes.request.last_shield).toBe(en.shields.delete.last);
    expect(ptBR.shields.delete.empty).toBe('O escudo está vazio.');
  });
});

describe("the Shields' Server Actions (Story 6.1)", () => {
  it('a new Shield: the name goes to the backend, then the toast naming it, the layout revalidated, and its screen', async () => {
    const server = await useBackend({ [`POST ${SHIELDS}`]: { status: 201, body: COMBAT } });

    const digest = await thrownDigest(() => createShieldAction(NEW, form({ campaign: CAMPAIGN, name: ' Combate ' })));

    expect(digest).toMatch(new RegExp(`^NEXT_REDIRECT;[a-z]+;/campaigns/${CAMPAIGN}/shields/${COMBAT_ID};`));
    expect(calls(server)).toEqual([`POST ${SHIELDS}`]);
    expect(JSON.parse(server.calls[0]!.body)).toEqual({ name: ' Combate ' });
    expect(server.calls[0]!.headers['x-session-token']).toBe(SESSION);
    expect(steps).toEqual(['flash success Escudo «Combate» criado.', 'revalidate / layout']);
  });

  it('a name refused (blank or too long, or taken) comes back under the name, what was typed kept, and no toast', async () => {
    const routes: Record<string, { status: number; body: unknown }> = {
      [`POST ${SHIELDS}`]: problem(400, 'request.shield_name_invalid', { min: 1, max: 120 }),
    };
    await useBackend(routes);

    expect(await createShieldAction(NEW, form({ campaign: CAMPAIGN, name: '   ' }))).toEqual({
      values: { name: '   ' },
      version: null,
      error: 'O nome precisa ter de 1 a 120 caracteres.',
      field: 'name',
      stale: false,
    });
    routes[`POST ${SHIELDS}`] = problem(409, 'request.shield_name_taken');
    cookieJar['__Host-gmshield-lang'] = 'en';
    expect(await createShieldAction(NEW, form({ campaign: CAMPAIGN, name: 'combate' }))).toMatchObject({
      values: { name: 'combate' },
      error: 'This campaign already has a Shield with this name.',
      field: 'name',
    });
    // A campaign gone meanwhile is said under the form.
    routes[`POST ${SHIELDS}`] = problem(404, 'request.not_found');
    expect(await createShieldAction(NEW, form({ campaign: CAMPAIGN, name: 'Combate' }))).toMatchObject({ error: 'Not found.', field: null });
    expect(flashed).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('a rename goes with its version, then the toast and the Shield\'s screen; a stale one brings the current name and version', async () => {
    const routes: Record<string, { status: number; body: unknown }> = {
      [`PATCH ${SHIELDS}/${FIRST_ID}`]: { status: 200, body: { ...FIRST, name: 'Exploração', version: 1 } },
    };
    const server = await useBackend(routes);
    const previous: ShieldFormState = { values: { name: '' }, version: 0, error: null, field: null, stale: false };
    const typed = { campaign: CAMPAIGN, id: FIRST_ID, version: '0', name: 'Exploração' };

    expect(await thrownDigest(() => renameShieldAction(previous, form(typed)))).toMatch(
      new RegExp(`^NEXT_REDIRECT;[a-z]+;/campaigns/${CAMPAIGN}/shields/${FIRST_ID};`),
    );
    expect(JSON.parse(server.calls[0]!.body)).toEqual({ version: 0, name: 'Exploração' });
    expect(steps).toEqual(['flash success Escudo renomeado para «Exploração».', 'revalidate / layout']);
    steps.length = 0;

    // Stale: the page says it changed elsewhere and shows the current stored name (empty while still unnamed).
    routes[`PATCH ${SHIELDS}/${FIRST_ID}`] = problem(409, 'request.stale_version');
    routes[`GET ${SHIELDS}/${FIRST_ID}`] = { status: 200, body: { ...FIRST, version: 4 } };
    expect(await renameShieldAction(previous, form(typed))).toEqual({
      values: { name: '' },
      version: 4,
      error: ptBR.shields.form.stale,
      field: null,
      stale: true,
    });
    routes[`GET ${SHIELDS}/${FIRST_ID}`] = { status: 200, body: { ...FIRST, name: 'Viagem', version: 5 } };
    expect((await renameShieldAction(previous, form(typed))).values).toEqual({ name: 'Viagem' });
    routes[`PATCH ${SHIELDS}/${FIRST_ID}`] = problem(409, 'request.shield_name_taken');
    expect(await renameShieldAction(previous, form(typed))).toMatchObject({
      error: ptBR.errors.codes.request.shield_name_taken,
      field: 'name',
      version: 0,
      stale: false,
    });
    expect(steps).toEqual([]);
  });

  it('never sends a malformed campaign, Shield or version to the backend', async () => {
    const server = await useBackend({});
    const previous: ShieldFormState = { values: { name: 'Combate' }, version: 2, error: null, field: null, stale: false };
    const typed = { campaign: CAMPAIGN, id: COMBAT_ID, version: '2', name: 'Combate' };
    cookieJar['__Host-gmshield-lang'] = 'en';

    for (const fields of [{ ...typed, campaign: '../me' }, { ...typed, id: 'x' }, { ...typed, version: '-1' }, { ...typed, version: '9'.repeat(16) }]) {
      expect((await renameShieldAction(previous, form(fields))).error).toBe('The request is not valid.');
    }
    expect((await createShieldAction(NEW, form({ campaign: 'nope', name: 'Combate' }))).error).toBe('The request is not valid.');
    expect(server.calls).toHaveLength(0);
  });
});

describe("a Shield's notes (Story 6.2 part A)", () => {
  const NOTES = `${SHIELDS}/${FIRST_ID}/notes`;
  const PISTAS = '0190a0b0-0000-7000-8000-000000000a12';
  const LEMBRETE = '0190a0b0-0000-7000-8000-000000000a11';
  const row = (id: string, name: string) => ({ id, recordType: 'note', name, version: 1, createdAt: '2026-11-27T12:00:00Z', sharedFrom: null, shieldId: FIRST_ID });
  const NOTE = {
    id: PISTAS,
    campaignId: CAMPAIGN,
    recordType: 'note',
    name: 'Pistas da cripta',
    fields: [],
    content: 'O sacerdote mente.',
    version: 1,
    currentVersion: 1,
    createdAt: '2026-11-27T12:00:00Z',
    conversationId: null,
    references: [],
    overrides: null,
    related: [],
    sharedWith: [],
    sharedFrom: null,
    shieldId: FIRST_ID,
  };

  it('lists the notes newest first, each opening its artifact page, under "Nova nota" first in the header as the one solid pill', async () => {
    const server = await useBackend({
      [`GET ${SHIELDS}/${FIRST_ID}`]: { status: 200, body: FIRST },
      [`GET ${NOTES}?limit=10`]: { status: 200, body: { items: [row(PISTAS, 'Pistas da cripta'), row(LEMBRETE, 'Lembrete')], total: 2 } },
    });
    for (const [language, messages] of LANGUAGES) {
      cookieJar['__Host-gmshield-lang'] = language;
      const html = renderToStaticMarkup(await ShieldPage({ params: Promise.resolve({ id: CAMPAIGN, shieldId: FIRST_ID }) }));

      expect(html).toContain(`aria-label="${escaped(messages.shields.notes.list)}"`);
      expect(html.indexOf('Lembrete')).toBeGreaterThan(html.indexOf('Pistas da cripta'));
      expect(linkTo(html, `/campaigns/${CAMPAIGN}/artifacts/${PISTAS}`)).not.toBe('');
      expect(linkTo(html, `/campaigns/${CAMPAIGN}/artifacts/${LEMBRETE}`)).not.toBe('');
      expect(html).not.toContain(messages.shields.empty);
      // "Nova nota" comes first, solid, before "Renomear"; it opens the new note's page.
      expect(solids(html)).toEqual([messages.shields.notes.new]);
      expect(linkTo(html, `/campaigns/${CAMPAIGN}/shields/${FIRST_ID}/notes/new`)).toContain('data-variant="solid"');
      expect(html.indexOf(`>${messages.shields.notes.new}</a>`)).toBeLessThan(html.indexOf(`>${messages.shields.rename}</a>`));
      expect(html).not.toMatch(/<[^>]+\sstyle=/);
    }
    expect(calls(server)).toContain(`GET ${NOTES}?limit=10`);
  });

  it('is paged: a later page is asked by its offset and the pager links stay on the Shield', async () => {
    const many = Array.from({ length: 10 }, (_, index) => row(`0190a0b0-0000-7000-8000-00000000c0${String(index).padStart(2, '0')}`, `Nota ${index + 11}`));
    const server = await useBackend({
      [`GET ${SHIELDS}/${FIRST_ID}`]: { status: 200, body: FIRST },
      [`GET ${NOTES}?limit=10&offset=10`]: { status: 200, body: { items: many, total: 23 } },
    });

    const html = renderToStaticMarkup(
      await ShieldPage({ params: Promise.resolve({ id: CAMPAIGN, shieldId: FIRST_ID }), searchParams: Promise.resolve({ page: '2' }) }),
    );

    expect(calls(server)).toContain(`GET ${NOTES}?limit=10&offset=10`);
    expect(html).toContain('Nota 11');
    expect(html).toContain(`href="/campaigns/${CAMPAIGN}/shields/${FIRST_ID}?page=3"`);
  });

  it('says why when the notes cannot be read, and still offers "Nova nota"', async () => {
    await useBackend({
      [`GET ${SHIELDS}/${FIRST_ID}`]: { status: 200, body: FIRST },
      [`GET ${NOTES}?limit=10`]: problem(503, 'server.unavailable'),
    });

    const html = renderToStaticMarkup(await ShieldPage({ params: Promise.resolve({ id: CAMPAIGN, shieldId: FIRST_ID }) }));

    expect(html).toContain('data-status="danger"');
    expect(html).toContain(ptBR.errors.codes.server.unavailable);
    expect(html).not.toContain(ptBR.shields.empty);
    expect(solids(html)).toEqual([ptBR.shields.notes.new]);
  });

  it('starts "Nova nota" empty under the way back to its Shield, with "Título", "Texto" and one solid "Salvar nota"', async () => {
    await useBackend({ [`GET ${SHIELDS}/${FIRST_ID}`]: { status: 200, body: FIRST } });
    for (const [language, messages] of LANGUAGES) {
      cookieJar['__Host-gmshield-lang'] = language;
      const html = renderToStaticMarkup(await NewNotePage({ params: Promise.resolve({ id: CAMPAIGN, shieldId: FIRST_ID }) }));

      expect(html).toMatch(new RegExp(`<h1[^>]*>${escaped(messages.shields.notes.form.title)}</h1>`));
      expect(linkTo(html, `/campaigns/${CAMPAIGN}/shields/${FIRST_ID}`)).not.toBe('');
      expect(html).toContain(`>${escaped(messages.shields.defaultName)}</a>`);
      expect(html).toMatch(new RegExp(`<label[^>]*>${messages.shields.notes.form.name}</label>`));
      expect(html).toMatch(new RegExp(`<label[^>]*>${messages.shields.notes.form.content}</label>`));
      expect(html).toMatch(/<input[^>]*name="name"[^>]*value=""/);
      expect(html).toMatch(/<textarea[^>]*name="content"[^>]*><\/textarea>/);
      expect(solids(html)).toEqual([messages.shields.notes.form.save]);
      // Online while rendering on the server: nothing says otherwise, and saving is not blocked.
      expect(html).not.toContain(messages.artifacts.edit.offline);
      expect(html).not.toContain('aria-disabled="true"');
    }
  });

  it('shows the single "Não encontrado." page for a Shield the backend does not find', async () => {
    await useBackend({ [`GET ${SHIELDS}/${COMBAT_ID}`]: problem(404, 'request.not_found') });

    expect(await thrownDigest(async () => NewNotePage({ params: Promise.resolve({ id: CAMPAIGN, shieldId: COMBAT_ID }) }))).toMatch(/NEXT_HTTP_ERROR_FALLBACK;404/);
  });

  it('creates: the title and text go to the backend, then the toast, the layout revalidated, and the note\'s artifact page', async () => {
    const server = await useBackend({ [`POST ${NOTES}`]: { status: 201, body: NOTE } });

    const digest = await thrownDigest(() =>
      createNoteAction(NO_NOTE, form({ campaign: CAMPAIGN, shield: FIRST_ID, name: ' Pistas da cripta ', content: 'O sacerdote mente.' })),
    );

    expect(digest).toMatch(new RegExp(`^NEXT_REDIRECT;[a-z]+;/campaigns/${CAMPAIGN}/artifacts/${PISTAS};`));
    expect(calls(server)).toEqual([`POST ${NOTES}`]);
    expect(server.calls[0]!.headers['x-session-token']).toBe(SESSION);
    // Sent as typed: the backend trims and checks.
    expect(JSON.parse(server.calls[0]!.body)).toEqual({ name: ' Pistas da cripta ', content: 'O sacerdote mente.' });
    expect(steps).toEqual(['flash success Nota «Pistas da cripta» criada.', 'revalidate / layout']);
    steps.length = 0;
    cookieJar['__Host-gmshield-lang'] = 'en';
    await thrownDigest(() => createNoteAction(NO_NOTE, form({ campaign: CAMPAIGN, shield: FIRST_ID, name: 'Pistas da cripta', content: '  ' })));
    expect(steps).toEqual(['flash success Note «Pistas da cripta» created.', 'revalidate / layout']);
    // A blank text is none.
    expect(JSON.parse(server.calls[1]!.body)).toEqual({ name: 'Pistas da cripta', content: null });
  });

  it('a title or a text outside its limits comes back under its field, with what was typed kept and no toast', async () => {
    const routes: Record<string, { status: number; body: unknown }> = {
      [`POST ${NOTES}`]: problem(400, 'request.invalid', { field: 'name', min: 1, max: 200 }),
    };
    await useBackend(routes);
    const typed = { campaign: CAMPAIGN, shield: FIRST_ID, name: '   ', content: 'Texto guardado' };

    expect(await createNoteAction(NO_NOTE, form(typed))).toEqual({
      serial: 1,
      values: { name: '   ', content: 'Texto guardado' },
      error: 'O título precisa ter de 1 a 200 caracteres.',
      field: 'name',
    });
    routes[`POST ${NOTES}`] = problem(400, 'request.invalid', { field: 'content', min: 0, max: 20000 });
    cookieJar['__Host-gmshield-lang'] = 'en';
    expect(await createNoteAction(NO_NOTE, form(typed))).toMatchObject({ error: 'The text can have up to 20000 characters.', field: 'content' });
    expect(steps).toEqual([]);
  });

  it('a Shield gone meanwhile is said under the form, with what was typed kept and no toast', async () => {
    await useBackend({ [`POST ${NOTES}`]: problem(404, 'request.not_found') });

    const state = await createNoteAction(NO_NOTE, form({ campaign: CAMPAIGN, shield: FIRST_ID, name: 'Pistas', content: 'Texto' }));

    expect(state).toEqual({ serial: 1, values: { name: 'Pistas', content: 'Texto' }, error: ptBR.errors.codes.request.not_found, field: null });
    expect(flashed).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('never sends a malformed campaign or Shield to the backend', async () => {
    const server = await useBackend({});
    cookieJar['__Host-gmshield-lang'] = 'en';

    const malformed: Record<string, string>[] = [{ campaign: '../me', shield: FIRST_ID }, { campaign: CAMPAIGN, shield: 'x' }, { campaign: CAMPAIGN }, {}];
    for (const fields of malformed) {
      expect((await createNoteAction(NO_NOTE, form({ ...fields, name: 'Pistas' }))).error).toBe('The request is not valid.');
    }
    expect(server.calls).toHaveLength(0);
  });

  it('keeps the same keys in both languages', () => {
    const keys = (value: unknown, prefix = ''): string[] =>
      typeof value === 'object' && value !== null
        ? Object.entries(value).flatMap(([key, inner]) => keys(inner, `${prefix}${key}.`))
        : [prefix];
    expect(keys(en.shields.notes).sort()).toEqual(keys(ptBR.shields.notes).sort());
    expect(Object.keys(en.feedback)).toContain('noteCreated');
    expect(Object.keys(ptBR.feedback)).toContain('noteCreated');
    expect(ptBR.artifacts.edit.offline).toBe('Sem conexão');
    expect(en.errors.codes.request.note_type_fixed).not.toBe('');
    expect(ptBR.errors.codes.request.note_type_fixed).not.toBe('');
  });
});
