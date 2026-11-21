import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The usability pass, third round (2026-11-21): a long list is paged, never one growing column. The page arithmetic,
 * the read of a whole list from the backend's cursors, the paged parts of the quality report, and "Ir para a página".
 */
let cookieJar: Record<string, string> = {};
vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: (name: string) => (Object.hasOwn(cookieJar, name) ? { name, value: cookieJar[name] } : undefined),
    set: () => undefined,
  }),
}));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ refresh: () => undefined, push: () => undefined, replace: () => undefined, prefetch: () => undefined }),
}));

const { readFileSync } = await import('node:fs');
const { join } = await import('node:path');
const { renderToStaticMarkup } = await import('react-dom/server');
const { DEFAULT_PAGE_SIZE, PAGE_SIZES, pageHref, pageOf, pageParam, pageWindow } = await import('@/paging');
const { everyPage, MOST_LIST_CALLS } = await import('@/server/every-page');
const { everyMaterial } = await import('@/server/materials');
const { default: MaterialPage } = await import('@/app/(signed-in)/files/[id]/page');
const { default: PagesIndex } = await import('@/app/(signed-in)/files/[id]/pages/page');
const { default: PageRoute } = await import('@/app/(signed-in)/files/[id]/pages/[page]/page');
const { startScripted } = await import('./support/servers');
type Scripted = Awaited<ReturnType<typeof startScripted>>;

const SESSION = 'sessionTokenBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const MATERIAL_ID = '0190a0b0-0000-7000-8000-000000000003';
const NOWHERE = { campaign: null, systems: [] };

let backend: Scripted | undefined;
async function useBackend(routes: Parameters<typeof startScripted>[0]): Promise<Scripted> {
  backend = await startScripted(routes);
  vi.stubEnv('GMSHIELD_MODE', '');
  vi.stubEnv('GMSHIELD_BACKEND_URL', backend.url);
  vi.stubEnv('GMSHIELD_FRONTEND_CREDENTIAL', 'configured-service-credential-0123456789');
  return backend;
}

beforeEach(() => {
  cookieJar = { '__Host-gmshield-session': `${SESSION}.9999999999` };
});

afterEach(async () => {
  await backend?.close();
  backend = undefined;
  vi.unstubAllEnvs();
});

describe('the page arithmetic', () => {
  const items = Array.from({ length: 23 }, (_, index) => index + 1);

  it('a page is ten rows unless the view says twenty or fifty', () => {
    expect(PAGE_SIZES).toEqual([10, 20, 50]);
    expect(DEFAULT_PAGE_SIZE).toBe(10);
  });

  it('cuts a page out of a list and says where it stands', () => {
    expect(pageOf(items, 1, 10)).toEqual({ rows: items.slice(0, 10), paging: { page: 1, pages: 3, total: 23, from: 1, to: 10, complete: true } });
    expect(pageOf(items, 3, 10)).toEqual({ rows: [21, 22, 23], paging: { page: 3, pages: 3, total: 23, from: 21, to: 23, complete: true } });
    // Past the end is the last page; before the start, or not a number, the first.
    expect(pageOf(items, 9, 10).paging.page).toBe(3);
    expect(pageOf(items, 0, 10).paging.page).toBe(1);
    expect(pageOf(items, Number.NaN, 10).paging.page).toBe(1);
    // An exact multiple has no empty last page, and an empty list is one empty page.
    expect(pageOf(items.slice(0, 20), 2, 10).paging).toMatchObject({ pages: 2, from: 11, to: 20 });
    expect(pageOf([], 1, 10)).toEqual({ rows: [], paging: { page: 1, pages: 1, total: 0, from: 0, to: 0, complete: true } });
    expect(pageOf(items, 1, 10, false).paging.complete).toBe(false);
  });

  it('reads a page number from the address, and anything else is the first page', () => {
    expect(pageParam('7')).toBe(7);
    expect(pageParam('999999')).toBe(999999);
    for (const junk of [undefined, '', '0', '-1', '07', '1.5', '1e3', ' 2', '1000000', ['2'], 2]) {
      expect(pageParam(junk), String(junk)).toBe(1);
    }
  });

  it('shows the first, the last and the pages around the current one, and never a gap that hides one page', () => {
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(pageWindow(1, 12)).toEqual([1, 2, 3, 4, null, 12]);
    expect(pageWindow(6, 12)).toEqual([1, null, 5, 6, 7, null, 12]);
    expect(pageWindow(12, 12)).toEqual([1, null, 9, 10, 11, 12]);
    // Page 3 of 12 would leave out page 2 alone: it shows.
    expect(pageWindow(4, 12)).toEqual([1, 2, 3, 4, 5, null, 12]);
    expect(pageWindow(9, 12)).toEqual([1, null, 8, 9, 10, 11, 12]);
    for (let page = 1; page <= 40; page++) {
      const window = pageWindow(page, 40);
      expect(window).toContain(page);
      expect(window.length).toBeLessThanOrEqual(7);
    }
  });

  it('builds a page address that keeps the other fields, and gives the first page one address', () => {
    expect(pageHref('/files', {}, 1)).toBe('/files');
    expect(pageHref('/files', {}, 3)).toBe('/files?page=3');
    expect(pageHref('/files', { state: 'ready', page: '9' }, 2)).toBe('/files?state=ready&page=2');
    expect(pageHref('/files', { state: 'ready', page: '9' }, 1)).toBe('/files?state=ready');
    // Two paged lists on one screen: each has its own field and keeps the other's.
    expect(pageHref('/files/x', { unreadable: '2' }, 3, 'outline')).toBe('/files/x?unreadable=2&outline=3');
    expect(pageHref('/a', { q: 'a b&c' }, 2)).toBe('/a?q=a+b%26c&page=2');
  });
});

describe('a whole list from the backend\'s cursors', () => {
  it('reads to the end, stops at 1,000 items and says the list was longer, and a refusal is the answer', async () => {
    let calls = 0;
    const whole = await everyPage<number>(async (cursor) => {
      calls += 1;
      return { ok: true, data: cursor === undefined ? { items: [1, 2], nextCursor: 'a' } : { items: [3] } };
    });
    expect(whole).toEqual({ ok: true, data: { items: [1, 2, 3], complete: true } });
    expect(calls).toBe(2);

    calls = 0;
    const endless = await everyPage<number>(async () => {
      calls += 1;
      return { ok: true, data: { items: [calls], nextCursor: 'next' } };
    });
    expect(calls).toBe(MOST_LIST_CALLS);
    expect(endless.ok && endless.data.complete).toBe(false);
    expect(endless.ok && endless.data.items).toHaveLength(MOST_LIST_CALLS);

    const refused = await everyPage<number>(async (cursor) =>
      cursor === undefined ? { ok: true, data: { items: [1], nextCursor: 'a' } } : { ok: false, status: 503, problem: { code: 'server.unavailable' } },
    );
    expect(refused).toEqual({ ok: false, status: 503, problem: { code: 'server.unavailable' } });
  });

  it('asks for the materials 50 at a time, with the states and the system, and follows the cursor', async () => {
    const cursor = '0190a0b0-0000-7000-8000-000000000041';
    const system = '0190a0b0-0000-7000-8000-000000000001';
    const material = (id: string) => ({ id, name: `${id}.pdf`, state: 'ready', actions: [], version: 0, belonging: NOWHERE });
    const first = `GET /api/v1/materials?state=ready&system=${system}&limit=50`;
    const server = await useBackend({
      [first]: { status: 200, body: { items: [material('a')], nextCursor: cursor } },
      [`${first}&cursor=${cursor}`]: { status: 200, body: { items: [material('b')] } },
    });
    const all = await everyMaterial(SESSION, ['ready'], { system });
    expect(all.ok && all.data.items.map((item) => item.id)).toEqual(['a', 'b']);
    expect(all.ok && all.data.complete).toBe(true);
    expect(server.calls.map((call) => `${call.method} ${call.url}`)).toEqual([first, `${first}&cursor=${cursor}`]);
    expect(server.calls.every((call) => call.headers['x-session-token'] === SESSION)).toBe(true);
  });
});

describe('the quality report of a long book', () => {
  const MATERIAL = `GET /api/v1/materials/${MATERIAL_ID}`;
  const pages = { done: 400, total: 400, text: { done: 400, total: 400 }, image: { done: 0, total: 0 }, readDirectly: 380, readByOcr: 0, unreadable: 20, reading: null };
  const report = {
    outline: Array.from({ length: 34 }, (_, index) => ({ level: index % 5 === 0 ? 1 : 2, title: `Seção ${index + 1}`, page: 10 + index })),
    unreadable: Array.from({ length: 15 }, (_, index) => ({ firstPage: 100 + index * 3, lastPage: 100 + index * 3 })),
    warnings: [{ code: 'report.pages_unreadable', count: 15 }],
  };
  const page = async (query: Record<string, string> = {}) =>
    renderToStaticMarkup(await MaterialPage({ params: Promise.resolve({ id: MATERIAL_ID }), searchParams: Promise.resolve(query) }));
  const sections = (html: string) => [...html.matchAll(/>(Seção \d+)<\/a>/g)].map((match) => match[1]);
  const runs = (html: string) => [...html.matchAll(/>Página (\d+)<\/a>/g)].map((match) => Number(match[1]));

  beforeEach(async () => {
    await useBackend({
      [MATERIAL]: { status: 200, body: { id: MATERIAL_ID, name: 'Livro.pdf', state: 'needs_review', actions: ['accept'], version: 0, belonging: NOWHERE, pages } },
      [`${MATERIAL}/report`]: { status: 200, body: report },
    });
  });

  it('shows ten sections and twelve unreadable runs at a time, each with its own small pager', async () => {
    const html = await page();
    expect(sections(html)).toEqual(report.outline.slice(0, 10).map((section) => section.title));
    expect(runs(html)).toEqual(report.unreadable.slice(0, 12).map((run) => run.firstPage));
    expect(html).toContain('1–10 de 34');
    expect(html).toContain('1–12 de 15');
    expect(html).toContain('aria-label="Páginas do sumário"');
    expect(html).toContain('aria-label="Páginas da lista de páginas ilegíveis"');
    expect(html).toContain(`href="/files/${MATERIAL_ID}?outline=2"`);
    expect(html).toContain(`href="/files/${MATERIAL_ID}?unreadable=2"`);
    // The warnings count the whole report, whatever page shows.
    expect(html).toContain('15 páginas não puderam ser lidas.');
    expect(html).not.toMatch(/<[^>]+\sstyle=/);
  });

  it('turning one list keeps the other, and a section sits at the same depth on every page', async () => {
    let html = await page({ outline: '4', unreadable: '2' });
    expect(sections(html)).toEqual(report.outline.slice(30).map((section) => section.title));
    expect(runs(html)).toEqual(report.unreadable.slice(12).map((run) => run.firstPage));
    expect(html).toContain('31–34 de 34');
    // Each pager's links carry the other list's page.
    expect(html).toContain(`href="/files/${MATERIAL_ID}?unreadable=2&amp;outline=3"`);
    expect(html).toContain(`href="/files/${MATERIAL_ID}?outline=4"`);
    // "Seção 31" is a chapter (level 1, the shallowest of the whole outline), though its page holds deeper ones first.
    expect(html).toMatch(/<li class="[^"]*level0[^"]*" data-level="1"><a[^>]*>Seção 31<\/a>/);
    expect(html).toMatch(/<li class="[^"]*level1[^"]*" data-level="2"><a[^>]*>Seção 32<\/a>/);
    // A page past the end is the last one.
    html = await page({ outline: '99' });
    expect(sections(html).at(-1)).toBe('Seção 34');
  });
});

describe('"Ir para a página"', () => {
  const MATERIAL = `GET /api/v1/materials/${MATERIAL_ID}`;
  const material = { id: MATERIAL_ID, name: 'Livro.pdf', state: 'ready', actions: [], version: 0, belonging: NOWHERE, pages: { done: 364, total: 364 } };
  const jump = (id: string, query: Readonly<Record<string, string | string[] | undefined>>) =>
    PagesIndex({ params: Promise.resolve({ id }), searchParams: Promise.resolve(query) }).then(
      () => null,
      (error: unknown) => String((error as { digest?: unknown }).digest ?? ''),
    );

  it('answers with the page\'s own address: the number asked, the last page for one past the end, the first otherwise', async () => {
    await useBackend({ [MATERIAL]: { status: 200, body: material } });
    expect(await jump(MATERIAL_ID, { page: '40' })).toMatch(new RegExp(`^NEXT_REDIRECT;[a-z]+;/files/${MATERIAL_ID}/pages/40;`));
    expect(await jump(MATERIAL_ID, { page: '999' })).toContain(`/files/${MATERIAL_ID}/pages/364;`);
    for (const query of [{}, { page: '0' }, { page: 'x' }, { page: ['3', '4'] }]) {
      expect(await jump(MATERIAL_ID, query)).toContain(`/files/${MATERIAL_ID}/pages/1;`);
    }
  });

  it('another owner\'s material is the single not-found page', async () => {
    await useBackend({});
    expect(await jump(MATERIAL_ID, { page: '2' })).toMatch(/^NEXT_HTTP_ERROR_FALLBACK;404/);
  });

  it('the page view offers the jump between its two page links, and shows a picture page at the height of the window', async () => {
    const picturePage = { page: 13, pageTotal: 364, picture: { width: 1545, height: 2000 }, lines: [{ text: 'Armor', box: [0.1, 0.1, 0.3, 0.12] }], text: null, passages: [] };
    await useBackend({
      [MATERIAL]: { status: 200, body: material },
      [`${MATERIAL}/pages/13?ground=review`]: { status: 200, body: picturePage },
      [`${MATERIAL}/pages/1?ground=review`]: { status: 200, body: { ...picturePage, page: 1, pageTotal: 1 } },
    });
    const route = async (number: string) => renderToStaticMarkup(await PageRoute({ params: Promise.resolve({ id: MATERIAL_ID, page: number }) }));
    let html = await route('13');
    // A plain GET form: it works without JavaScript, and the address it posts to answers with the page.
    expect(html).toMatch(new RegExp(`<form[^>]*action="/files/${MATERIAL_ID}/pages"[^>]*method="get"|<form[^>]*method="get"[^>]*action="/files/${MATERIAL_ID}/pages"`));
    expect(html).toMatch(/<label[^>]*for="page-jump"[^>]*>Ir para a página<\/label>/);
    const input = /<input[^>]*id="page-jump"[^>]*>/.exec(html)?.[0] ?? '';
    for (const attribute of ['type="number"', 'name="page"', 'min="1"', 'max="364"', 'value="13"', 'inputMode="numeric"']) {
      expect(input.toLowerCase(), attribute).toContain(attribute.toLowerCase());
    }
    expect(html).toContain('>Ir</button>');
    // The picture fits the window, and the header alone says which page it is.
    expect(html).toContain('data-fit="room"');
    expect(html).not.toContain('<figcaption');
    expect(html.match(/Página 13 de 364/g)).toHaveLength(2);
    // A material of one page has nowhere to jump.
    html = await route('1');
    expect(html).not.toContain('page-jump');
  });
});

describe('one thing scrolls at a time', () => {
  const ROOT = join(import.meta.dirname, '..');
  const css = (file: string) => readFileSync(join(ROOT, 'src', file), 'utf8');
  /** The declarations of the first rule whose selector list is exactly `selector`. */
  const rule = (text: string, selector: string) => {
    const at = text.indexOf(`\n${selector} {`);
    return at === -1 ? '' : text.slice(at, text.indexOf('}', at));
  };

  it('a picture page that fits its room is sized like a picture, in its own shape, with no style attribute', async () => {
    const { PageView } = await import('@/components/PageView');
    const page = { page: 1, pageTotal: 1, picture: { width: 1545, height: 2000 }, lines: [], text: null, passages: [] } as never;
    const fitted = renderToStaticMarkup(PageView({ page, pictureSrc: '/p', language: 'pt-BR', caption: false, fit: true }));
    const svg = /<svg[^>]*>/.exec(fitted)?.[0] ?? '';
    const [width, height] = [Number(/ width="(\d+)"/.exec(svg)?.[1]), Number(/ height="(\d+)"/.exec(svg)?.[1])];
    // Larger than any screen, so the stylesheet's limits always bring it down, and the same shape as the picture.
    expect(Math.min(width, height)).toBeGreaterThanOrEqual(4000);
    expect(width / height).toBeCloseTo(1545 / 2000, 6);
    expect(svg).toContain('viewBox="0 0 1545 2000"');
    expect(fitted).toContain('data-fit="room"');
    expect(fitted).not.toMatch(/<[^>]+\sstyle=/);
    // Without it the page is as wide as its column: no size of its own.
    const plain = renderToStaticMarkup(PageView({ page, pictureSrc: '/p', language: 'pt-BR' }));
    expect(/<svg[^>]*>/.exec(plain)?.[0]).not.toMatch(/ (width|height)="/);
    expect(plain).not.toContain('data-fit');
    const view = css('components/PageView.module.css');
    expect(rule(view, ".view[data-fit='room'] .page")).toMatch(/max-width: 100%;[\s\S]*max-height: var\(--page-height, none\)/);
    // The screens that fit a page say how tall its room is.
    expect(css('components/SourceView.module.css')).toMatch(/\.body \{\s*--page-height:/);
    expect(css('app/(signed-in)/files/[id]/pages/[page]/page.module.css')).toMatch(/--page-height:/);
  });

  it('the guided upload scrolls its step, never the whole dialog, so its title and its actions stay in view', () => {
    const uploads = css('components/uploads/Uploads.module.css');
    expect(rule(uploads, '.dialog')).toMatch(/overflow: hidden/);
    expect(rule(uploads, '.dialogBody')).toMatch(/min-height: 0;[\s\S]*overflow-y: auto/);
    // The systems to tick are columns in that step, with no scroll box of their own inside it.
    const picker = rule(css('components/PlacePicker.module.css'), '.checks');
    expect(picker).toMatch(/display: grid/);
    expect(picker).not.toMatch(/overflow|max-height/);
  });

  it('the sidebar and the right panel are fixed to the window, and the development indicator adds no height', () => {
    expect(rule(css('components/Sidebar.module.css'), '.panel')).toMatch(/position: fixed/);
    expect(rule(css('components/Shell.module.css'), '.panel')).toMatch(/position: fixed/);
    // `next dev` puts its indicator under the page: 46px of scrolling on every screen that fills the window.
    expect(readFileSync(join(ROOT, 'next.config.ts'), 'utf8')).toMatch(/devIndicators: false/);
  });

  /** The declarations of every rule whose selector is exactly `selector`, one after another. */
  const every = (text: string, selector: string) =>
    text
      .split('\n}')
      .filter((block) => block.trimStart().split(' {')[0]?.split('\n').at(-1) === selector)
      .map((block) => block.slice(block.indexOf('{') + 1))
      .join('\n');

  it('a menu floats over what is under it: the campaign switcher never pushes the navigation down', () => {
    const switcher = css('components/CampaignSwitcher.module.css');
    // One rule for the sidebar and the bar: the list is out of the flow, under its button.
    expect(every(switcher, '.panel')).toMatch(/position: absolute;[\s\S]*top: 100%/);
    expect(rule(switcher, '.sidebar .panel')).toMatch(/right: 0/);
    expect(switcher).not.toMatch(/\.bar \.panel \{[^}]*position:/);
  });

  it('a closed sidebar is opened from a menu button at the top left, in the bar, at every width', () => {
    const sidebar = css('components/Sidebar.module.css');
    const handle = every(sidebar, '.handle');
    expect(handle).toMatch(/position: absolute;/);
    expect(handle).toMatch(/top: calc\(\(var\(--height-bar\) - var\(--space-touch-target\)\) \/ 2\)/);
    expect(handle).toMatch(/left: var\(--space-3\)/);
    // No tab at mid-height any more, and no width at which the handle moves.
    expect(sidebar).not.toMatch(/top: 50%/);
    expect(sidebar).not.toMatch(/translateY/);
    // Under 1280px, where the sidebar starts closed, the bar keeps the button's room and the page keeps its gutter.
    const shell = css('components/Shell.module.css');
    expect(shell).toMatch(/@media \(max-width: 1279px\) \{\s*\.bar \{\s*padding-left: calc\(var\(--space-touch-target\) \+ var\(--space-1\)\);/);
    expect(shell).not.toMatch(/\.column \{\s*padding-left: calc\(var\(--space-touch-target\)/);
  });

  it('the newest turn of a conversation has the room to come to the top of the window', () => {
    const conversation = css('components/conversation/Conversation.module.css');
    expect(rule(conversation, '.turn')).toMatch(/scroll-margin-top/);
    expect(rule(conversation, '.turn:last-child:not(:first-child)')).toMatch(/min-height: calc\(100dvh - /);
  });
});
