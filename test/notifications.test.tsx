import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The usability pass (2026-11-21): the notifications (toasts, the flash cookie, the bell's list), and a list's display
 * options, thumbnails and preview panel.
 */
const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => '/files',
  useRouter: () => router,
}));

const { NotificationsProvider, useNotifications } = await import('@/components/notifications/NotificationsProvider');
const { NotificationCenter } = await import('@/components/notifications/NotificationCenter');
const { ItemList } = await import('@/components/ItemList');
const { ViewMenu } = await import('@/components/ViewMenu');
const { FLASH_COOKIE, flashValue } = await import('@/flash-cookie');
const { DEFAULT_VIEW, VIEW_COOKIE } = await import('@/view-cookie');

/** jsdom keeps no `Secure` cookie on its http page: the tests keep `document.cookie` themselves. */
let cookies: Record<string, string> = {};
let written: string[] = [];
beforeEach(() => {
  cookies = {};
  written = [];
  Object.defineProperty(document, 'cookie', {
    configurable: true,
    get: () => Object.entries(cookies).map(([name, value]) => `${name}=${value}`).join('; '),
    set: (line: string) => {
      written.push(line);
      const [pair = '', ...attributes] = line.split(';').map((part) => part.trim());
      const [name = '', ...value] = pair.split('=');
      if (attributes.includes('Max-Age=0')) {
        delete cookies[name];
      } else {
        cookies[name] = value.join('=');
      }
    },
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Reflect.deleteProperty(document, 'cookie');
});

function Teller({ status = 'success', message = 'Sistema criado.' }: { readonly status?: 'success' | 'danger' | 'warning' | 'info'; readonly message?: string }) {
  const { notify } = useNotifications();
  return (
    <button type="button" onClick={() => notify({ status, message, link: { href: '/systems/x', label: 'Abrir' } })}>
      dizer
    </button>
  );
}

const toasts = () => screen.getByRole('region', { name: 'Avisos' });

describe('the notifications', () => {
  it('a toast says what happened with its status as a word, announced politely, and goes by itself after 6 seconds', () => {
    vi.useFakeTimers();
    render(
      <NotificationsProvider language="pt-BR">
        <Teller />
      </NotificationsProvider>,
    );
    expect(within(toasts()).queryAllByRole('listitem')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'dizer' }));
    const said = within(toasts()).getByRole('status');
    expect(said.textContent).toBe('Pronto. Sistema criado. Abrir');
    expect(within(said).getByRole('link', { name: 'Abrir' }).getAttribute('href')).toBe('/systems/x');
    act(() => vi.advanceTimersByTime(5900));
    expect(within(toasts()).getAllByRole('listitem')).toHaveLength(1);
    act(() => vi.advanceTimersByTime(200));
    expect(within(toasts()).queryAllByRole('listitem')).toHaveLength(0);
  });

  it('an error is an alert that stays until it is dismissed, and the pointer over a toast keeps it there', () => {
    vi.useFakeTimers();
    render(
      <NotificationsProvider language="pt-BR">
        <Teller status="danger" message="O envio falhou." />
      </NotificationsProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'dizer' }));
    expect(within(toasts()).getByRole('alert').textContent).toContain('Erro. O envio falhou.');
    act(() => vi.advanceTimersByTime(60_000));
    expect(within(toasts()).getAllByRole('listitem')).toHaveLength(1);
    fireEvent.click(within(toasts()).getByRole('button', { name: 'Dispensar aviso' }));
    expect(within(toasts()).queryAllByRole('listitem')).toHaveLength(0);
    cleanup();

    render(
      <NotificationsProvider language="pt-BR">
        <Teller />
      </NotificationsProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'dizer' }));
    const item = within(toasts()).getByRole('listitem');
    fireEvent.pointerEnter(item);
    act(() => vi.advanceTimersByTime(20_000));
    expect(within(toasts()).getAllByRole('listitem')).toHaveLength(1);
    fireEvent.pointerLeave(item);
    act(() => vi.advanceTimersByTime(6100));
    expect(within(toasts()).queryAllByRole('listitem')).toHaveLength(0);
  });

  it('shows at most three toasts, the newest ones', () => {
    render(
      <NotificationsProvider language="en">
        <Teller status="danger" />
      </NotificationsProvider>,
    );
    for (let i = 0; i < 5; i++) {
      fireEvent.click(screen.getByRole('button', { name: 'dizer' }));
    }
    expect(within(screen.getByRole('region', { name: 'Messages' })).getAllByRole('listitem')).toHaveLength(3);
  });

  it('reads what a Server Action left in the flash cookie once, tells it and clears the cookie', () => {
    cookies[FLASH_COOKIE] = encodeURIComponent(flashValue({ status: 'success', message: 'Campanha «Mesa de sexta» arquivada.' }));
    const { rerender } = render(
      <NotificationsProvider language="pt-BR">
        <p>página</p>
      </NotificationsProvider>,
    );
    expect(within(toasts()).getByRole('status').textContent).toBe('Pronto. Campanha «Mesa de sexta» arquivada.');
    expect(cookies[FLASH_COOKIE]).toBeUndefined();
    expect(written).toEqual([`${FLASH_COOKIE}=; Path=/; Max-Age=0; Secure; SameSite=Lax`]);
    // The layout renders again (a refresh, another page): nothing is told twice, and a new flash is told.
    rerender(
      <NotificationsProvider language="pt-BR">
        <p>outra página</p>
      </NotificationsProvider>,
    );
    expect(within(toasts()).getAllByRole('listitem')).toHaveLength(1);
    cookies[FLASH_COOKIE] = encodeURIComponent(flashValue({ status: 'success', message: 'Sistema excluído.' }));
    rerender(
      <NotificationsProvider language="pt-BR">
        <p>mais uma</p>
      </NotificationsProvider>,
    );
    expect(within(toasts()).getAllByRole('listitem')).toHaveLength(2);
  });

  it('a notification its teller already announces is seen and not announced again', () => {
    function Quiet() {
      const { notify } = useNotifications();
      return (
        <button type="button" onClick={() => notify({ status: 'success', message: 'Livro.pdf enviado.', quiet: true })}>
          dizer
        </button>
      );
    }
    render(
      <NotificationsProvider language="pt-BR">
        <Quiet />
      </NotificationsProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'dizer' }));
    expect(within(toasts()).getByRole('listitem').textContent).toContain('Livro.pdf enviado.');
    expect(within(toasts()).queryByRole('status')).toBeNull();
  });

  it('outside a provider nothing is told and nothing fails', () => {
    render(<Teller />);
    fireEvent.click(screen.getByRole('button', { name: 'dizer' }));
    expect(screen.queryByRole('region')).toBeNull();
  });
});

describe('the bell', () => {
  const attention = [
    { id: 'm1', status: 'warning' as const, message: 'Bestiário.pdf precisa de revisão.', link: { href: '/files/m1', label: 'Revisar' } },
    { id: 'm2', status: 'danger' as const, message: 'Scan.pdf falhou.', link: { href: '/files/m2', label: 'Abrir' } },
  ];

  it('counts what waits and what is new, lists both when opened, and marks the visit seen', async () => {
    const user = userEvent.setup();
    render(
      <NotificationsProvider language="pt-BR">
        <Teller />
        <NotificationCenter language="pt-BR" attention={attention} />
      </NotificationsProvider>,
    );
    const bell = () => screen.getByRole('button', { name: /^Notificações/ });
    expect(bell().getAttribute('aria-label')).toBe('Notificações, 2 novas');
    expect(bell().getAttribute('aria-expanded')).toBe('false');
    await user.click(screen.getByRole('button', { name: 'dizer' }));
    expect(bell().getAttribute('aria-label')).toBe('Notificações, 3 novas');

    await user.click(bell());
    expect(bell().getAttribute('aria-expanded')).toBe('true');
    const list = screen.getByRole('group', { name: 'Notificações' });
    expect(within(list).getByText('Esperando por você')).toBeTruthy();
    expect(within(list).getByRole('link', { name: 'Revisar' }).getAttribute('href')).toBe('/files/m1');
    // "Abrir" twice: the failed material that waits, and the link of the visit's own notification.
    expect(within(list).getAllByRole('link', { name: 'Abrir' }).map((link) => link.getAttribute('href'))).toEqual(['/files/m2', '/systems/x']);
    expect(within(list).getByText('Nesta visita')).toBeTruthy();
    expect(list.textContent).toContain('Pronto. Sistema criado.');
    expect(list.querySelector('time')?.getAttribute('datetime')).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // Seen: the visit's notification no longer counts, and its toast has gone; what waits still counts.
    expect(bell().getAttribute('aria-label')).toBe('Notificações, 2 novas');
    expect(within(toasts()).queryAllByRole('listitem')).toHaveLength(0);

    // "Limpar" empties the visit's list; what waits stays.
    await user.click(within(list).getByRole('button', { name: 'Limpar' }));
    expect(list.textContent).not.toContain('Sistema criado.');
    expect(list.textContent).toContain('Bestiário.pdf precisa de revisão.');

    // Esc closes it and gives focus back to the bell.
    await user.keyboard('{Escape}');
    expect(bell().getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(bell());
  });

  it('says in a toast, once, what starts to wait during the visit; what waited on arrival is on the bell alone', () => {
    const tree = (waiting: typeof attention) => (
      <NotificationsProvider language="pt-BR">
        <NotificationCenter language="pt-BR" attention={waiting} />
      </NotificationsProvider>
    );
    const { rerender } = render(tree([attention[0]!]));
    expect(within(toasts()).queryAllByRole('listitem')).toHaveLength(0);
    // The layout renders again with a file that has just failed: a toast, with its link.
    rerender(tree(attention));
    const said = within(toasts()).getAllByRole('listitem');
    expect(said).toHaveLength(1);
    expect(said[0]!.textContent).toContain('Erro. Scan.pdf falhou.');
    expect(within(said[0]!).getByRole('link', { name: 'Abrir' }).getAttribute('href')).toBe('/files/m2');
    // Counted once, as something that waits, and not listed a second time under "Nesta visita".
    expect(screen.getByRole('button', { name: 'Notificações, 2 novas' })).toBeTruthy();
    expect(screen.queryByText('Nesta visita')).toBeNull();
    // The same list again: nothing more is said.
    rerender(tree([...attention]));
    expect(within(toasts()).getAllByRole('listitem')).toHaveLength(1);
  });

  it('lists the first five things that wait and links to the rest in "Meus Arquivos"; the bell counts them all', async () => {
    const user = userEvent.setup();
    const waiting = (count: number, status: 'warning' | 'danger', from = 0) =>
      Array.from({ length: count }, (_, index) => ({ id: `w${from + index}`, status, message: `Arquivo ${from + index + 1}.pdf espera.`, link: { href: `/files/w${from + index}`, label: 'Revisar' } }));
    const tree = (attention: ReturnType<typeof waiting>) => (
      <NotificationsProvider language="pt-BR">
        <NotificationCenter language="pt-BR" attention={attention} />
      </NotificationsProvider>
    );
    const { rerender } = render(tree(waiting(8, 'warning')));
    await user.click(screen.getByRole('button', { name: 'Notificações, 8 novas' }));
    const list = screen.getByRole('group', { name: 'Notificações' });
    expect(within(list).getAllByRole('link', { name: 'Revisar' })).toHaveLength(5);
    expect(list.textContent).not.toContain('Arquivo 6.pdf');
    expect(within(list).getByRole('link', { name: 'Mais 3 em Meus Arquivos' }).getAttribute('href')).toBe('/files?state=review');
    // When what is left out failed, the link opens the failed ones.
    rerender(tree([...waiting(5, 'warning'), ...waiting(2, 'danger', 5)]));
    expect(within(list).getByRole('link', { name: 'Mais 2 em Meus Arquivos' }).getAttribute('href')).toBe('/files?state=failed');
    // Five or fewer: every one, and no link to more.
    rerender(tree(waiting(5, 'warning')));
    expect(within(list).queryByRole('link', { name: /em Meus Arquivos/ })).toBeNull();
  });

  it('with nothing to say, says so, and a press outside closes it', async () => {
    const user = userEvent.setup();
    render(
      <NotificationsProvider language="en">
        <NotificationCenter language="en" />
        <p>elsewhere</p>
      </NotificationsProvider>,
    );
    const bell = screen.getByRole('button', { name: 'Notifications' });
    await user.click(bell);
    expect(screen.getByText('No notifications in this visit.')).toBeTruthy();
    fireEvent.pointerDown(screen.getByText('elsewhere'));
    expect(bell.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('a list\'s display options, thumbnails and preview', () => {
  const PICTURE = '/api/v1/materials/a/pages/1/picture?ground=review';
  const rows = [
    { id: 'a', label: 'Livro.pdf', detail: '1,2 MB · 320 páginas', href: '/files/a', state: { state: 'ready' as const, word: 'pronto' }, thumbnail: PICTURE, pages: 2 },
    { id: 'b', label: 'Notas.md', detail: 'Sem lugar', href: '/files/b', state: { state: 'processing' as const, word: 'processando' }, thumbnail: null, pages: null },
  ];
  const page = (number: number) => ({ page: number, pageTotal: 2, picture: null, lines: [], text: `Texto da página ${number}.`, passages: [], outcome: 'read_directly' });

  it('"Exibição" switches list and grid, comfortable and compact, at once, and keeps the choice in the view cookie', async () => {
    const user = userEvent.setup();
    cookies[VIEW_COOKIE] = 'files:list:comfortable:1|campaigns:grid:compact:1|systems:list:comfortable:1';
    render(
      <ItemList label="Seus arquivos" rows={rows} viewKey="files" view={DEFAULT_VIEW} language="pt-BR" />,
    );
    const list = screen.getByRole('list', { name: 'Seus arquivos' });
    expect(list.dataset.layout).toBe('list');
    expect(list.dataset.density).toBe('comfortable');
    const menu = screen.getByRole('button', { name: 'Exibição' });
    expect(menu.getAttribute('aria-expanded')).toBe('false');
    await user.click(menu);
    const options = screen.getByRole('group', { name: 'Exibição' });
    expect((within(options).getByRole('radio', { name: 'Lista' }) as HTMLInputElement).checked).toBe(true);
    await user.click(within(options).getByRole('radio', { name: 'Grade' }));
    expect(list.dataset.layout).toBe('grid');
    await user.click(within(options).getByRole('radio', { name: 'Compacto' }));
    expect(list.dataset.density).toBe('compact');
    // The other lists keep what the cookie held for them.
    expect(cookies[VIEW_COOKIE]).toBe('files:grid:compact:1:10|campaigns:grid:compact:1:10|systems:list:comfortable:1:10|conversations:list:comfortable:1:10|recordTypes:list:comfortable:1:10');
    expect(written.at(-1)).toMatch(/; Path=\/; Max-Age=31536000; Secure; SameSite=Lax$/);

    // Thumbnails off: the picture gives way to the list's icon, and the choice is kept.
    expect(list.querySelector('img')?.getAttribute('src')).toBe(PICTURE);
    await user.click(within(options).getByRole('checkbox', { name: 'Mostrar miniaturas' }));
    expect(list.querySelector('img')).toBeNull();
    expect(cookies[VIEW_COOKIE]).toMatch(/^files:grid:compact:0:10\|/);
    await user.keyboard('{Escape}');
    expect(menu.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(menu);
  });

  it('a list without display options has no menu, and one without thumbnails offers none', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ItemList label="Lista" rows={rows} />);
    expect(screen.queryByRole('button', { name: 'Exibição' })).toBeNull();
    rerender(
      <ItemList label="Lista" rows={[rows[1]!]} viewKey="systems" view={DEFAULT_VIEW} language="en" />,
    );
    await user.click(screen.getByRole('button', { name: 'View' }));
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getAllByRole('radio')).toHaveLength(4);
  });

  it('a thumbnail is decorative, loads lazily, and gives way to the icon when its picture cannot be shown', () => {
    render(<ItemList label="Lista" rows={rows} />);
    const list = screen.getByRole('list', { name: 'Lista' });
    const picture = list.querySelector('img')!;
    expect(picture.getAttribute('alt')).toBe('');
    expect(picture.getAttribute('loading')).toBe('lazy');
    // The row's link is still named by the material alone, its state and its detail.
    expect(within(list).getAllByRole('link')[0]!.textContent).toBe('Livro.pdfpronto1,2 MB · 320 páginas');
    fireEvent.error(picture);
    expect(list.querySelector('img')).toBeNull();
  });

  it('"Pré-visualizar" opens the material\'s pages in a panel, turns them, and gives focus back when it closes', async () => {
    const user = userEvent.setup();
    const load = vi.fn(async (_id: string, number: number) => (number === 2 ? null : page(number)));
    render(
      <ItemList
        label="Seus arquivos"
        rows={rows}
        viewKey="files"
        view={DEFAULT_VIEW}
        language="pt-BR"
        preview={{ load, label: 'Pré-visualizar {name}' }}
      />,
    );
    // Only a material with pages offers it.
    expect(screen.getAllByRole('button', { name: /^Pré-visualizar/ })).toHaveLength(1);
    const opener = screen.getByRole('button', { name: 'Pré-visualizar Livro.pdf' });
    expect(opener.closest('a')).toBeNull();
    await user.click(opener);
    const panel = await screen.findByRole('dialog', { name: 'Livro.pdf' });
    expect(document.activeElement).toBe(within(panel).getByRole('button', { name: 'Fechar pré-visualização' }));
    expect(await within(panel).findByText('Texto da página 1.')).toBeTruthy();
    expect(load).toHaveBeenCalledWith('a', 1);
    expect(within(panel).getByText('Página 1 de 2')).toBeTruthy();
    expect(within(panel).getByRole('link', { name: 'Abrir arquivo' }).getAttribute('href')).toBe('/files/a');
    expect((within(panel).getByRole('button', { name: 'Página anterior' }) as HTMLButtonElement).disabled).toBe(true);

    // The next page cannot be read: it says so, and "Tentar de novo" asks again.
    await user.click(within(panel).getByRole('button', { name: 'Próxima página' }));
    expect((await within(panel).findByRole('alert')).textContent).toBe('Não foi possível carregar esta página.');
    expect((within(panel).getByRole('button', { name: 'Próxima página' }) as HTMLButtonElement).disabled).toBe(true);
    load.mockImplementation(async (_id: string, number: number) => page(number));
    await user.click(within(panel).getByRole('button', { name: 'Tentar de novo' }));
    expect(await within(panel).findByText('Texto da página 2.')).toBeTruthy();

    // ← goes back a page; Esc closes the panel and focus returns to the control that opened it.
    await user.keyboard('{ArrowLeft}');
    expect(await within(panel).findByText('Texto da página 1.')).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    await act(async () => {
      await Promise.resolve();
    });
    expect(document.activeElement).toBe(opener);
  });

  it('Story 3.12: the saved items panel opened over a preview closes it, and focus stays in the new panel', async () => {
    const { SavedItemsProvider } = await import('@/components/saved/SavedItems');
    const { SavedItemsPanel } = await import('@/components/saved/SavedItemsPanel');
    const { ShellFrame } = await import('@/components/ShellPanel');
    const user = userEvent.setup();
    const load = vi.fn(async (_id: string, number: number) => page(number));
    render(
      <SavedItemsProvider currentCampaignId={null}>
        <ShellFrame>
          <ItemList label="Seus arquivos" rows={rows} viewKey="files" view={DEFAULT_VIEW} language="pt-BR" preview={{ load, label: 'Pré-visualizar {name}' }} />
          <SavedItemsPanel language="pt-BR" action={async (previous) => previous} load={async () => ({ ok: true, items: [], total: 0 })} />
        </ShellFrame>
      </SavedItemsProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Pré-visualizar Livro.pdf' }));
    expect(await screen.findByRole('dialog', { name: 'Livro.pdf' })).toBeTruthy();

    await user.keyboard('{Control>}{Shift>}s{/Shift}{/Control}');

    expect(screen.queryByRole('dialog', { name: 'Livro.pdf' })).toBeNull();
    expect(screen.getAllByRole('complementary')).toHaveLength(1);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Fechar itens salvos' }));
  });

  it('the view menu on its own reports each choice to its owner', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ViewMenu view={DEFAULT_VIEW} language="en" previews onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'View' }));
    await user.click(screen.getByRole('radio', { name: 'Grid' }));
    expect(onChange).toHaveBeenLastCalledWith({ layout: 'grid', density: 'comfortable', previews: true, size: 10 });
    await user.click(screen.getByRole('checkbox', { name: 'Show thumbnails' }));
    expect(onChange).toHaveBeenLastCalledWith({ layout: 'list', density: 'comfortable', previews: false, size: 10 });
    // A list that is not paged has no rows-a-page choice.
    expect(screen.queryByRole('radio', { name: '20' })).toBeNull();
  });

  it('a paged list turns its pages above and under the rows, and choosing the rows a page starts again from the first', async () => {
    const user = userEvent.setup();
    router.replace.mockClear();
    router.refresh.mockClear();
    const paging = (page: number) => ({ page, pages: 12, total: 115, from: (page - 1) * 10 + 1, to: page * 10 });
    const list = (page: number) => (
      <ItemList label="Seus arquivos" rows={rows} pages={{ paging: paging(page), path: '/files', query: { state: 'ready' } }} viewKey="files" view={DEFAULT_VIEW} language="pt-BR" />
    );
    const { rerender } = render(list(6));
    // Under the rows: the rows shown, previous and next, and the numbers around the current page with the ends.
    const under = screen.getByRole('navigation', { name: 'Paginação' });
    expect(within(under).getAllByRole('link').map((link) => link.textContent)).toEqual(['Anterior', '1', '5', '6', '7', '12', 'Próxima']);
    expect(within(under).getByRole('link', { name: 'Página 6, página atual' }).getAttribute('aria-current')).toBe('page');
    expect(within(under).getByRole('link', { name: 'Página 7' }).getAttribute('href')).toBe('/files?state=ready&page=7');
    expect(within(under).getByRole('link', { name: 'Página 1' }).getAttribute('href')).toBe('/files?state=ready');
    expect(within(under).getByRole('link', { name: 'Anterior' }).getAttribute('rel')).toBe('prev');
    // Above them: the same range and the two arrows, named for a screen reader.
    const above = screen.getByRole('navigation', { name: 'Paginação, acima da lista' });
    expect(within(above).getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual(['/files?state=ready&page=5', '/files?state=ready&page=7']);
    expect(screen.getAllByText('51–60 de 115')).toHaveLength(2);

    // Another number of rows a page: kept in the cookie, and the list starts again from its first page.
    await user.click(screen.getByRole('button', { name: 'Exibição' }));
    const sizes = within(screen.getByRole('group', { name: 'Exibição' })).getByRole('group', { name: 'Por página' });
    expect(within(sizes).getAllByRole('radio').map((radio) => (radio as HTMLInputElement).checked)).toEqual([true, false, false]);
    await user.click(within(sizes).getByRole('radio', { name: '20' }));
    expect(cookies[VIEW_COOKIE]).toMatch(/^files:list:comfortable:1:20\|/);
    expect(router.replace).toHaveBeenCalledWith('/files?state=ready');
    expect(router.refresh).not.toHaveBeenCalled();
    // Already on the first page: the same address, so the server is asked again in place.
    rerender(list(1));
    await user.click(within(sizes).getByRole('radio', { name: '50' }));
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledTimes(1);
    // The first page: "Anterior" leads nowhere, stays in place, and is not a link.
    expect(within(under).queryByRole('link', { name: 'Anterior' })).toBeNull();
    expect(within(under).getByText('Anterior').closest('[aria-disabled="true"]')).not.toBeNull();
    // A layout or a spacing is the browser's alone: no question to the server.
    await user.click(screen.getByRole('radio', { name: 'Grade' }));
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it('a list of one page says how many rows it has, with no pager; an empty one says nothing', () => {
    const one = { page: 1, pages: 1, total: 2, from: 1, to: 2 };
    const { rerender } = render(<ItemList label="Lista" rows={rows} pages={{ paging: one, path: '/files' }} viewKey="files" view={DEFAULT_VIEW} language="en" />);
    expect(screen.getByText('2 items')).toBeTruthy();
    expect(screen.queryByRole('navigation')).toBeNull();
    rerender(<ItemList label="Lista" rows={[rows[0]!]} pages={{ paging: { ...one, total: 1, to: 1 }, path: '/files' }} viewKey="files" view={DEFAULT_VIEW} language="en" />);
    expect(screen.getByText('1 item')).toBeTruthy();
  });
});

describe('a control that is busy, and a page that failed', () => {
  it('a pending pill shows a spinner before its text and says it is busy; otherwise neither', async () => {
    const { PillButton } = await import('@/components/PillButton');
    const { rerender } = render(<PillButton pending>Salvar</PillButton>);
    const button = screen.getByRole('button', { name: 'Salvar' });
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.dataset.pending).toBe('true');
    expect(button.querySelector('span[aria-hidden="true"]')).not.toBeNull();
    rerender(<PillButton>Salvar</PillButton>);
    expect(button.getAttribute('aria-busy')).toBeNull();
    expect(button.dataset.pending).toBeUndefined();
    expect(button.querySelector('span')).toBeNull();
  });

  it('the error screen says in the page\'s language that the page could not be shown, and offers to try again or leave', async () => {
    const { ErrorScreen } = await import('@/components/ErrorScreen');
    const user = userEvent.setup();
    const retry = vi.fn();
    document.documentElement.lang = 'pt-BR';
    const { unmount } = render(<ErrorScreen retry={retry} />);
    const alert = screen.getByRole('alert');
    expect(within(alert).getByRole('heading', { level: 1 }).textContent).toBe('Esta página não pôde ser mostrada.');
    expect(within(alert).getByRole('link', { name: 'Ir para o início' }).getAttribute('href')).toBe('/');
    await user.click(within(alert).getByRole('button', { name: 'Tentar de novo' }));
    expect(retry).toHaveBeenCalledTimes(1);
    // Never a code, a stack or the failure's own words.
    expect(alert.textContent).not.toMatch(/Error|digest|\bat \w/);
    unmount();
    document.documentElement.lang = 'en';
    render(<ErrorScreen retry={retry} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('This page could not be shown.');
    document.documentElement.lang = '';
  });
});
