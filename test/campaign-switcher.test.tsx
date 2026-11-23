import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

let pathname = '/questions';
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ refresh: () => undefined, push: () => undefined, replace: () => undefined, prefetch: () => undefined }),
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
}));
vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => undefined }),
}));

const { CampaignSwitcher } = await import('@/components/CampaignSwitcher');
const { CampaignAction } = await import('@/components/CampaignAction');
const { CampaignForm } = await import('@/components/CampaignForm');
const { NoCampaignConversation } = await import('@/components/conversation/Conversation');
const { Shell } = await import('@/components/Shell');
const ptBR = (await import('@/messages/pt-BR.json')).default;
const en = (await import('@/messages/en.json')).default;

type State = { error: string | null; done: number };

const FIRST = '0190a0b0-0000-7000-8000-000000000002';
const THURSDAY = '0190a0b0-0000-7000-8000-000000000040';
const CAMPAIGNS = [
  { id: THURSDAY, name: 'Mesa de quinta', system: 'D&D 5.2.1' },
  { id: FIRST, name: 'Primeira campanha', system: 'Sistema sem nome' },
];
const LABELS = {
  none: ptBR.shell.noCampaign,
  panel: ptBR.shell.switchCampaign,
  list: ptBR.shell.campaignChoices,
  current: ptBR.shell.currentMark,
  all: ptBR.shell.allCampaigns,
  create: ptBR.shell.newCampaign,
};

/** An action that records what was posted and answers what it is told, one answer per call. */
function recorder(answers: ((previous: State) => State)[]) {
  const posted: Record<string, string>[] = [];
  const action = vi.fn(async (previous: State, form: FormData) => {
    posted.push(Object.fromEntries([...form.entries()].map(([key, value]) => [key, String(value)])));
    return (answers.shift() ?? ((state: State) => state))(previous);
  });
  return { posted, action };
}

const succeed = (previous: State): State => ({ error: null, done: previous.done + 1 });
const refuse = (previous: State): State => ({ ...previous, error: 'Não encontrado.' });

afterEach(() => {
  cleanup();
  pathname = '/questions';
});

describe('the campaign switcher (Story 3.2)', () => {
  it('opens a list of the campaigns in use with their system, the current one marked in words, then the two links', async () => {
    const user = userEvent.setup();
    const { action } = recorder([]);
    const { container } = render(
      <CampaignSwitcher labels={LABELS} current={{ id: FIRST, name: 'Primeira campanha' }} campaigns={CAMPAIGNS} placement="sidebar" action={action} />,
    );
    const button = screen.getByRole('button', { name: 'Primeira campanha' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    const panel = container.querySelector(`#${CSS.escape(button.getAttribute('aria-controls') ?? '')}`) as HTMLElement;
    expect(panel.hidden).toBe(true);

    await user.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(panel.hidden).toBe(false);
    const group = screen.getByRole('group', { name: 'Trocar de campanha' });
    const list = within(group).getByRole('list', { name: 'Suas campanhas' });
    const items = within(list).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual(['Mesa de quintaD&D 5.2.1', 'Primeira campanhaSistema sem nomeatual']);
    // The current one is marked in words and is not a choice; the others are.
    expect(within(items[1]!).queryByRole('button')).toBeNull();
    expect(items[1]!.querySelector('[aria-current="true"]')).not.toBeNull();
    expect(within(items[0]!).getByRole('button', { name: /Mesa de quinta/ })).toBeTruthy();
    expect(within(group).getByRole('link', { name: 'Ver todas as mesas' }).getAttribute('href')).toBe('/campaigns');
    expect(within(group).getByRole('link', { name: 'Nova campanha' }).getAttribute('href')).toBe('/campaigns/new');
    expect(container.querySelectorAll('[style]')).toHaveLength(0);
  });

  it('Esc closes it, gives focus back to the button and is marked handled, so the sidebar does not close too', async () => {
    const user = userEvent.setup();
    const { action } = recorder([]);
    render(<CampaignSwitcher labels={LABELS} current={{ id: FIRST, name: 'Primeira campanha' }} campaigns={CAMPAIGNS} placement="bar" action={action} />);
    const button = screen.getByRole('button', { name: 'Primeira campanha' });
    await user.click(button);
    await user.tab();
    expect(document.activeElement?.textContent).toContain('Mesa de quinta');
    let prevented: boolean | null = null;
    const listener = (event: KeyboardEvent) => {
      prevented = event.defaultPrevented;
    };
    window.addEventListener('keydown', listener);
    await user.keyboard('{Escape}');
    window.removeEventListener('keydown', listener);
    expect(prevented).toBe(true);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(button);
  });

  it('picking a campaign posts it; the list closes once it is current, and stays open with the refusal otherwise', async () => {
    const user = userEvent.setup();
    const { posted, action } = recorder([refuse, succeed]);
    render(<CampaignSwitcher labels={LABELS} current={{ id: FIRST, name: 'Primeira campanha' }} campaigns={CAMPAIGNS} placement="sidebar" action={action} />);
    const button = screen.getByRole('button', { name: 'Primeira campanha' });
    await user.click(button);

    await user.click(screen.getByRole('button', { name: /Mesa de quinta/ }));
    await vi.waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Não encontrado.'));
    expect(posted).toEqual([{ id: THURSDAY }]);
    expect(button.getAttribute('aria-expanded')).toBe('true');

    await user.click(screen.getByRole('button', { name: /Mesa de quinta/ }));
    await vi.waitFor(() => expect(button.getAttribute('aria-expanded')).toBe('false'));
    expect(posted).toEqual([{ id: THURSDAY }, { id: THURSDAY }]);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a press outside it closes it, a press inside does not; moving to another page closes it', async () => {
    const user = userEvent.setup();
    const { action } = recorder([]);
    const switcher = () => (
      <div>
        <p>outside</p>
        <CampaignSwitcher labels={LABELS} current={{ id: FIRST, name: 'Primeira campanha' }} campaigns={CAMPAIGNS} placement="bar" action={action} />
      </div>
    );
    const { rerender } = render(switcher());
    const button = screen.getByRole('button', { name: 'Primeira campanha' });
    await user.click(button);
    fireEvent.pointerDown(screen.getByRole('group', { name: 'Trocar de campanha' }));
    expect(button.getAttribute('aria-expanded')).toBe('true');
    fireEvent.pointerDown(screen.getByText('outside'));
    expect(button.getAttribute('aria-expanded')).toBe('false');

    // The layout, and so the switcher, stays across pages: a new path closes the open list.
    await user.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    pathname = '/campaigns';
    rerender(switcher());
    expect(button.getAttribute('aria-expanded')).toBe('false');
    await user.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
  });

  it('with no campaign the button says so, and the list offers only the two links', async () => {
    const user = userEvent.setup();
    const { action } = recorder([]);
    render(<CampaignSwitcher labels={LABELS} current={null} campaigns={[]} placement="bar" action={action} />);
    await user.click(screen.getByRole('button', { name: 'Nenhuma campanha' }));
    const group = screen.getByRole('group', { name: 'Trocar de campanha' });
    expect(within(group).queryByRole('list')).toBeNull();
    expect(within(group).getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual(['/campaigns', '/campaigns/new']);
  });

  it('is under the logo and on the context bar\'s campaign name; "Minhas Mesas" is current on a campaign\'s pages', () => {
    for (const path of ['/campaigns', '/campaigns/new', `/campaigns/${FIRST}`, `/campaigns/${FIRST}/edit`]) {
      pathname = path;
      const { unmount } = render(
        <Shell
          preferences={{ theme: 'dark', language: 'en' }}
          username="u"
          current={{ id: FIRST, system: 'Untitled system', campaign: 'First campaign' }}
          campaigns={[{ id: FIRST, name: 'First campaign', system: 'Untitled system' }]}
          sidebar="open"
        >
          <h1>Page</h1>
        </Shell>,
      );
      const current = screen.getAllByRole('link').filter((link) => link.getAttribute('aria-current') === 'page');
      expect(current.map((link) => link.textContent), path).toEqual(['My Tables']);
      const sidebar = screen.getByTestId('sidebar');
      const context = screen.getByRole('navigation', { name: en.shell.context });
      expect(within(sidebar).getByRole('button', { name: 'First campaign' }).getAttribute('aria-expanded')).toBe('false');
      expect(within(context).getByRole('button', { name: 'First campaign' }).getAttribute('aria-expanded')).toBe('false');
      unmount();
    }
  });
});

describe('a campaign action pill (Story 3.2)', () => {
  it('posts its fields and shows a refusal under it', async () => {
    const user = userEvent.setup();
    const { posted, action } = recorder([refuse]);
    const { rerender } = render(<CampaignAction key={THURSDAY} label="Arquivar" fields={{ id: THURSDAY, version: '2', archived: 'true' }} action={action} />);
    await user.click(screen.getByRole('button', { name: 'Arquivar' }));
    await vi.waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Não encontrado.'));
    expect(posted).toEqual([{ id: THURSDAY, version: '2', archived: 'true' }]);
    // The page's refresh after the action brings the campaign's newer version; keyed by the campaign, the pill and its
    // alert stay.
    rerender(<CampaignAction key={THURSDAY} label="Arquivar" fields={{ id: THURSDAY, version: '3', archived: 'true' }} action={action} />);
    expect(screen.getByRole('alert').textContent).toBe('Não encontrado.');
    expect((document.querySelector('input[name="version"]') as HTMLInputElement).value).toBe('3');
  });
});

describe('the campaign form (Story 3.2)', () => {
  it('shows a refusal under the field it is about, linked to it, with the values kept', async () => {
    const user = userEvent.setup();
    const action = vi.fn(async () => ({
      values: { name: 'Mesa de quinta', systemId: THURSDAY },
      version: null,
      error: 'Este sistema já tem uma campanha com este nome, talvez arquivada.',
      field: 'name' as const,
      stale: false,
    }));
    render(
      <CampaignForm
        labels={{ name: 'Nome', system: 'Sistema', submit: 'Criar campanha', cancel: 'Cancelar' }}
        initial={{ values: { name: '', systemId: THURSDAY }, version: null, error: null, field: null, stale: false }}
        systems={[{ id: THURSDAY, label: 'D&D 5.2.1' }]}
        cancelHref="/campaigns"
        action={action}
      />,
    );
    await user.type(screen.getByRole('textbox', { name: 'Nome' }), 'Mesa de quinta');
    await user.click(screen.getByRole('button', { name: 'Criar campanha' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Este sistema já tem uma campanha com este nome, talvez arquivada.');
    const name = screen.getByRole('textbox', { name: 'Nome' });
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(name.getAttribute('aria-describedby')).toBe(alert.id);
    expect((name as HTMLInputElement).value).toBe('Mesa de quinta');
    expect(screen.getByRole('combobox', { name: 'Sistema' })).toBeTruthy();
  });
});

describe('the questions screen with no campaign (Story 3.2)', () => {
  it('shows the composer disabled, with the reason and a link to a new campaign, in both languages', () => {
    for (const [language, messages] of [['pt-BR', ptBR], ['en', en]] as const) {
      const { container, unmount } = render(<NoCampaignConversation language={language} />);
      const field = screen.getByRole('textbox', { name: messages.conversation.composer.label });
      expect((field as HTMLTextAreaElement).disabled).toBe(true);
      const reason = document.getElementById(field.getAttribute('aria-describedby') ?? '');
      expect(reason?.textContent).toContain(messages.conversation.noCampaign);
      expect((screen.getByRole('button', { name: messages.conversation.composer.send }) as HTMLButtonElement).disabled).toBe(true);
      expect(screen.getByRole('link', { name: messages.conversation.newCampaign }).getAttribute('href')).toBe('/campaigns/new');
      expect(container.querySelectorAll('[style]')).toHaveLength(0);
      expect(messages.conversation.noCampaign).not.toMatch(/!|\p{Extended_Pictographic}/u);
      unmount();
    }
  });
});
