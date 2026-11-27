import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

type SetCall = { name: string; value: string; options: Record<string, unknown> };
const setCalls: SetCall[] = [];
// A list asks for the router (it starts again from the first page when the rows a page change); here there is none.
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ refresh: () => undefined, push: () => undefined, replace: () => undefined, prefetch: () => undefined }),
}));
vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: () => undefined,
    set: (name: string, value: string, options: Record<string, unknown>) => setCalls.push({ name, value, options }),
  }),
}));

const { PillButton, SolidPillButton } = await import('@/components/PillButton');
const { ConfirmationDialog } = await import('@/components/ConfirmationDialog');
const { Notice } = await import('@/components/Notice');
const { PreferencesForm } = await import('@/components/PreferencesForm');
const { PageView, pictureUrl } = await import('@/components/PageView');
const { MaterialActions } = await import('@/components/MaterialActions');
const { SystemActions } = await import('@/components/SystemActions');
const { CampaignDeleteAction } = await import('@/components/CampaignDeleteAction');
const { ArtifactDeleteAction } = await import('@/components/ArtifactDeleteAction');
const { ShieldDeleteAction } = await import('@/components/ShieldDeleteAction');
const { ConversationDeleteAction } = await import('@/components/conversation/ConversationDeleteAction');
const { MaterialDeleteAction } = await import('@/components/MaterialDeleteAction');
const { SupersededVersions } = await import('@/components/SupersededVersions');
const { References } = await import('@/components/conversation/References');
const { TierLabel, tierWord } = await import('@/components/TierLabel');
const { SourceView } = await import('@/components/SourceView');
const { translator } = await import('@/messages');

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
  setCalls.length = 0;
});

function expectNoStyleAttribute(container: HTMLElement) {
  expect(container.querySelectorAll('[style]')).toHaveLength(0);
}

describe('PillButton', () => {
  it('is a type="button" pill by default, with solid and danger variants', () => {
    const { container } = render(
      <>
        <PillButton>Ir</PillButton>
        <SolidPillButton>Salvar</SolidPillButton>
        <PillButton variant="danger" type="submit">
          Excluir
        </PillButton>
      </>,
    );
    const [plain, solid, danger] = screen.getAllByRole('button');
    expect(plain).toHaveProperty('type', 'button');
    expect(plain?.dataset.variant).toBe('default');
    expect(solid?.dataset.variant).toBe('solid');
    expect(danger?.dataset.variant).toBe('danger');
    expect(danger).toHaveProperty('type', 'submit');
    expectNoStyleAttribute(container);
  });
});

function DialogHost({ onConfirm = () => {} }: { onConfirm?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <PillButton onClick={() => setOpen(true)}>Excluir material</PillButton>
      <ConfirmationDialog
        open={open}
        title="Excluir «SRD 5.2.1»?"
        consequence="O material e suas 412 páginas deixam a biblioteca."
        confirmLabel="Excluir"
        language="pt-BR"
        onConfirm={() => {
          onConfirm();
          setOpen(false);
        }}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}

describe('ConfirmationDialog', () => {
  it('opens as a modal named by its title, with "Cancelar" by default and focus on it', async () => {
    const user = userEvent.setup();
    const { container } = render(<DialogHost />);
    const dialogElement = container.querySelector('dialog');
    expect(dialogElement?.open).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Excluir material' }));
    const dialog = screen.getByRole('dialog', { name: 'Excluir «SRD 5.2.1»?' });
    expect(dialog).toBe(dialogElement);
    expect(dialogElement?.open).toBe(true);
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy();
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expectNoStyleAttribute(container);
  });

  it('keeps Tab inside: past the last control back to the first, and Shift+Tab the other way', async () => {
    const user = userEvent.setup();
    render(<DialogHost />);
    await user.click(screen.getByRole('button', { name: 'Excluir material' }));
    const dialog = screen.getByRole('dialog');
    const cancel = within(dialog).getByRole('button', { name: 'Cancelar' });
    const confirm = within(dialog).getByRole('button', { name: 'Excluir' });
    await user.tab();
    expect(document.activeElement).toBe(confirm);
    await user.tab();
    expect(document.activeElement).toBe(cancel);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(confirm);
  });

  it('closes on Esc and returns focus to the opener', async () => {
    const user = userEvent.setup();
    const { container } = render(<DialogHost />);
    const opener = screen.getByRole('button', { name: 'Excluir material' });
    await user.click(opener);
    await user.keyboard('{Escape}');
    expect(container.querySelector('dialog')?.open).toBe(false);
    expect(document.activeElement).toBe(opener);
  });

  it('confirms through the danger pill, then returns focus to the opener', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<DialogHost onConfirm={onConfirm} />);
    const opener = screen.getByRole('button', { name: 'Excluir material' });
    await user.click(opener);
    const confirm = within(screen.getByRole('dialog')).getByRole('button', { name: 'Excluir' });
    expect(confirm.dataset.variant).toBe('danger');
    expect(confirm.hasAttribute('aria-describedby')).toBe(false);
    await user.click(confirm);
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(opener);
  });

  it('Story 5.7 part B: a confirmation not available yet says so, keeps its focus and ignores presses; a solid one removes nothing', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const { rerender } = render(
      <ConfirmationDialog
        open
        title="t"
        consequence="c"
        confirmLabel="Exportar"
        confirmTone="solid"
        confirmDisabled
        confirmDescribedBy="why"
        language="pt-BR"
        onConfirm={onConfirm}
        onCancel={() => {}}
      >
        <p id="why">Marque ao menos um.</p>
      </ConfirmationDialog>,
    );
    const confirm = within(screen.getByRole('dialog')).getByRole('button', { name: 'Exportar' });
    expect(confirm.getAttribute('aria-describedby')).toBe('why');
    expect(confirm.dataset.variant).toBe('solid');
    expect(confirm.getAttribute('aria-disabled')).toBe('true');
    expect(confirm.hasAttribute('disabled')).toBe(false);
    await user.click(confirm);
    await user.tab({ shift: true });
    await user.tab();
    expect(document.activeElement).toBe(confirm);
    await user.keyboard('{Enter}');
    expect(onConfirm).not.toHaveBeenCalled();

    rerender(
      <ConfirmationDialog open title="t" consequence="c" confirmLabel="Exportar" confirmTone="solid" language="pt-BR" onConfirm={onConfirm} onCancel={() => {}} />,
    );
    expect(confirm.hasAttribute('aria-disabled')).toBe(false);
    await user.click(confirm);
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('routes the browser close request (cancel event) to onCancel', () => {
    const onCancel = vi.fn();
    const { container } = render(
      <ConfirmationDialog open title="t" consequence="c" confirmLabel="ok" cancelLabel="Voltar" language="en" onConfirm={() => {}} onCancel={onCancel} />,
    );
    expect(screen.getByRole('button', { name: 'Voltar' })).toBeTruthy();
    const event = new Event('cancel', { cancelable: true });
    act(() => {
      container.querySelector('dialog')?.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('returns focus to the opener when unmounted while open', async () => {
    const user = userEvent.setup();
    function Host() {
      const [open, setOpen] = useState(false);
      const [mounted, setMounted] = useState(true);
      return (
        <>
          <PillButton onClick={() => setOpen(true)}>Abrir</PillButton>
          <PillButton onClick={() => setMounted(false)}>Remover</PillButton>
          {mounted ? (
            <ConfirmationDialog open={open} title="t" consequence="c" confirmLabel="ok" language="pt-BR" onConfirm={() => {}} onCancel={() => setMounted(false)} />
          ) : null}
        </>
      );
    }
    const { container } = render(<Host />);
    const opener = screen.getByRole('button', { name: 'Abrir' });
    await user.click(opener);
    expect(document.activeElement).toBe(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar' }));
    // The parent removes the dialog without closing it first (Cancelar unmounts it here).
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar' }));
    expect(container.querySelector('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('says "Cancel" in English', async () => {
    render(<ConfirmationDialog open title="t" consequence="c" confirmLabel="Delete" language="en" onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
  });
});

describe('Notice', () => {
  it('is a polite status with its status word, message, link and dismiss control', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    const { container } = render(
      <Notice status="warning" message="1 material precisa de revisão." language="pt-BR" link={{ href: '/materiais', label: 'Revisar' }} onDismiss={onDismiss} />,
    );
    const notice = screen.getByRole('status');
    expect(notice.textContent).toContain('Atenção');
    expect(notice.textContent).toContain('1 material precisa de revisão.');
    expect(within(notice).getByRole('link', { name: 'Revisar' }).getAttribute('href')).toBe('/materiais');
    expectNoStyleAttribute(container);
    await user.click(within(notice).getByRole('button', { name: 'Dispensar aviso' }));
    expect(screen.queryByRole('status')).toBeNull();
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('shows a different notice again after one was dismissed', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Notice status="danger" message="Primeiro." language="pt-BR" />);
    await user.click(screen.getByRole('button', { name: 'Dispensar aviso' }));
    expect(screen.queryByRole('status')).toBeNull();
    rerender(<Notice status="danger" message="Primeiro." language="pt-BR" />);
    expect(screen.queryByRole('status')).toBeNull();
    rerender(<Notice status="danger" message="Segundo." language="pt-BR" />);
    expect(screen.getByRole('status').textContent).toContain('Segundo.');
    rerender(<Notice status="success" message="Primeiro." language="pt-BR" />);
    expect(screen.getByRole('status').textContent).toContain('Pronto');
  });

  it('one that is not dismissible has no dismiss control, in either language, and still says its status', () => {
    for (const [language, word] of [
      ['pt-BR', 'Atenção'],
      ['en', 'Warning'],
    ] as const) {
      const { container } = render(<Notice status="warning" message="Preparando as fontes para busca: faltam 2 trechos" language={language} dismissible={false} />);
      const notice = screen.getByRole('status');
      expect(notice.textContent).toContain(word);
      expect(notice.textContent).toContain('Preparando as fontes para busca: faltam 2 trechos');
      expect(within(notice).queryByRole('button')).toBeNull();
      expect(notice.className).toMatch(/still/);
      expectNoStyleAttribute(container);
      cleanup();
    }
    // The default stays dismissible.
    render(<Notice status="warning" message="m" language="en" />);
    expect(screen.getByRole('button', { name: 'Dismiss notice' })).toBeTruthy();
    expect(screen.getByRole('status').className).not.toMatch(/still/);
  });

  it('one that is not live has no status role, so its changing text is never announced again', () => {
    const { container, rerender } = render(<Notice status="warning" message="faltam 2000 trechos" language="pt-BR" dismissible={false} live={false} />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(container.querySelector('[aria-live]')).toBeNull();
    const line = container.querySelector('[data-status="warning"]')!;
    expect(line.getAttribute('role')).toBeNull();
    expect(line.textContent).toBe('Atençãofaltam 2000 trechos');
    rerender(<Notice status="warning" message="faltam 1500 trechos" language="pt-BR" dismissible={false} live={false} />);
    expect(container.querySelector('[data-status="warning"]')!.textContent).toContain('faltam 1500 trechos');
    expect(screen.queryByRole('status')).toBeNull();
    expectNoStyleAttribute(container);
    // The default stays live.
    cleanup();
    render(<Notice status="warning" message="m" language="en" />);
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('writes each status as a word, in both languages', () => {
    for (const [status, word] of [
      ['danger', 'Error'],
      ['warning', 'Warning'],
      ['success', 'Done'],
    ] as const) {
      render(<Notice status={status} message="m" language="en" />);
      expect(screen.getByRole('status').textContent).toContain(word);
      expect(screen.getByRole('button', { name: 'Dismiss notice' })).toBeTruthy();
      expect(screen.queryByRole('link')).toBeNull();
      cleanup();
    }
  });
});

describe('PreferencesForm', () => {
  // Usability pass (2026-11-21): segmented controls of submit buttons; a press applies that one choice at once.
  it('has two labelled groups of buttons, the current choice pressed, and no "Aplicar" step', () => {
    const { container } = render(<PreferencesForm theme="dark" language="pt-BR" />);
    const theme = screen.getByRole('group', { name: 'Tema' });
    const language = screen.getByRole('group', { name: 'Idioma' });
    const themes = within(theme).getAllByRole('button') as HTMLButtonElement[];
    expect(themes.map((button) => [button.name, button.value, button.type])).toEqual([
      ['theme', 'illustrated', 'submit'],
      ['theme', 'dark', 'submit'],
      ['theme', 'light', 'submit'],
    ]);
    expect(themes.map((button) => button.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false']);
    // Each theme has an icon beside its name; the name alone names the button.
    expect(themes.every((button) => button.querySelector('svg[aria-hidden="true"]') !== null)).toBe(true);
    expect(within(language).getByRole('button', { name: 'Português (Brasil)' }).getAttribute('aria-pressed')).toBe('true');
    const english = within(language).getByRole('button', { name: 'English' }) as HTMLButtonElement;
    expect([english.name, english.value, english.getAttribute('aria-pressed'), english.lang]).toEqual(['language', 'en', 'false', 'en']);
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Aplicar' })).toBeNull();
    expect(screen.getByRole('form', { name: 'Preferências' }).dataset.layout).toBe('stack');
    expectNoStyleAttribute(container);
  });

  it('labels everything in English', () => {
    render(<PreferencesForm theme="illustrated" language="en" />);
    expect(screen.getByRole('form', { name: 'Preferences' })).toBeTruthy();
    expect(within(screen.getByRole('group', { name: 'Theme' })).getByRole('button', { name: 'Illustrated' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('group', { name: 'Language' })).toBeTruthy();
    cleanup();
    // At the top of the sign-in screen: the same groups, side by side.
    render(<PreferencesForm theme="illustrated" language="en" layout="inline" />);
    expect(screen.getByRole('form', { name: 'Preferences' }).dataset.layout).toBe('inline');
    expect(screen.getByRole('group', { name: 'Theme' })).toBeTruthy();
  });

  it('a press posts that one choice to the Server Action, which sets its cookie and leaves the other alone', async () => {
    const user = userEvent.setup();
    setCalls.length = 0;
    render(<PreferencesForm theme="illustrated" language="pt-BR" />);
    await user.click(screen.getByRole('button', { name: 'Claro' }));
    await vi.waitFor(() => expect(setCalls).toHaveLength(1));
    expect(setCalls.map(({ name, value }) => [name, value])).toEqual([['__Host-gmshield-theme', 'light']]);
    await user.click(screen.getByRole('button', { name: 'English' }));
    await vi.waitFor(() => expect(setCalls).toHaveLength(2));
    expect(setCalls.map(({ name, value }) => [name, value])).toEqual([
      ['__Host-gmshield-theme', 'light'],
      ['__Host-gmshield-lang', 'en'],
    ]);
  });
});

describe('UsernameForm', () => {
  it('labels its fields, links both drafts, and has one solid pill', async () => {
    const { UsernameForm } = await import('@/components/UsernameForm');
    const action = vi.fn(async () => ({ username: '', termsAccepted: false, error: null, field: null }));
    const { container } = render(<UsernameForm language="pt-BR" action={action} />);
    expect(screen.getByLabelText('Nome de usuário')).toHaveProperty('name', 'username');
    expect(screen.getByRole('checkbox', { name: 'Li e aceito os termos de uso e o aviso de privacidade.' })).toHaveProperty('value', 'accepted');
    expect(screen.getByRole('link', { name: 'Ler os termos de uso' }).getAttribute('href')).toBe('/terms');
    expect(screen.getByRole('link', { name: 'Ler o aviso de privacidade' }).getAttribute('href')).toBe('/privacy');
    expect(screen.getByRole('button', { name: 'Criar conta' }).dataset.variant).toBe('solid');
    expect(screen.queryByRole('alert')).toBeNull();
    expectNoStyleAttribute(container);
  });

  it('shows a refusal under its field and keeps what was typed', async () => {
    const { UsernameForm } = await import('@/components/UsernameForm');
    const user = userEvent.setup();
    const action = vi
      .fn()
      .mockResolvedValueOnce({ username: 'Mestre', termsAccepted: true, error: 'Este nome de usuário já está em uso.', field: 'username' })
      .mockResolvedValueOnce({ username: 'Outro', termsAccepted: false, error: 'Aceite os termos.', field: 'terms' });
    render(<UsernameForm language="pt-BR" action={action} />);
    await user.type(screen.getByLabelText('Nome de usuário'), 'Mestre');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Criar conta' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Este nome de usuário já está em uso.');
    const input = screen.getByLabelText('Nome de usuário') as HTMLInputElement;
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe(alert.id);
    expect(input.value).toBe('Mestre');
    const submitted = action.mock.calls[0]?.[1] as FormData;
    expect(submitted.get('username')).toBe('Mestre');
    expect(submitted.get('terms')).toBe('accepted');

    await user.clear(input);
    await user.type(input, 'Outro');
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Criar conta' }));
    await act(async () => {});
    const termsAlert = await screen.findByRole('alert');
    expect(termsAlert.textContent).toBe('Aceite os termos.');
    expect(screen.getByRole('checkbox').getAttribute('aria-describedby')).toBe(termsAlert.id);
    expect((screen.getByLabelText('Nome de usuário') as HTMLInputElement).getAttribute('aria-invalid')).toBe('false');
  });
});

describe('PageView (Story 1.19)', () => {
  const MATERIAL = '0190a0b0-0000-7000-8000-000000000003';
  const picturePage = {
    page: 13,
    pageTotal: 364,
    picture: { width: 1545, height: 2000 },
    lines: [
      { text: 'Armor', box: [0.1, 0.1, 0.3, 0.125] },
      { text: 'Plate | 1,500 gp | 18', box: [0.1372, 0.18, 0.5281, 0.1975] },
      { text: '<img src=x onerror=alert(1)>', box: [0, 0.9, 0.2, 0.92] },
    ],
    text: null,
    passages: [],
    outcome: 'read_directly',
  };

  it('draws a picture page as one SVG in its pixels: frame, picture, then one transparent text per line fitted to its box', () => {
    const { container } = render(<PageView page={picturePage} pictureSrc={pictureUrl(MATERIAL, 13)} language="pt-BR" />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('viewBox')).toBe('0 0 1545 2000');
    expect(svg.getAttribute('role')).toBe('group');
    expect(svg.getAttribute('aria-label')).toBe('Página 13 de 364');
    // The frame comes first, so it shows (with the page number) before the picture arrives.
    const children = [...svg.children].map((child) => child.tagName.toLowerCase());
    expect(children).toEqual(['rect', 'image', 'text', 'text', 'text']);
    const image = svg.querySelector('image')!;
    expect(image.getAttribute('href')).toBe(`/api/v1/materials/${MATERIAL}/pages/13/picture?ground=review`);
    expect(image.getAttribute('aria-hidden')).toBe('true');
    const texts = [...svg.querySelectorAll('text')];
    expect(texts.map((text) => text.textContent)).toEqual(picturePage.lines.map((line) => line.text));
    const plate = texts[1]!;
    // Left at 0.1372 x 1545, the box 0.0175 x 2000 = 35 px high: the baseline at 80% of it, glyphs at 90%.
    expect(plate.getAttribute('x')).toBe('212');
    expect(plate.getAttribute('y')).toBe('388');
    expect(plate.getAttribute('font-size')).toBe('31.5');
    expect(plate.getAttribute('textLength')).toBe('603.9');
    expect(plate.getAttribute('lengthAdjust')).toBe('spacingAndGlyphs');
    for (const text of texts) {
      expect(text.getAttribute('class')).toMatch(/line/);
    }
    // Line text is text, never HTML.
    expect(svg.querySelector('img')).toBeNull();
    expect(texts[2]!.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(screen.getByText('Página 13 de 364', { selector: 'figcaption' })).toBeTruthy();
    expectNoStyleAttribute(container);
  });

  it('shows a text page as its text with its line breaks, never as HTML, and no picture', () => {
    const page = { page: 2, pageTotal: 9, picture: null, lines: [], text: '# Regras\n\n<b>negrito</b>', passages: [], outcome: 'read_directly' };
    const { container } = render(<PageView page={page} pictureSrc={pictureUrl(MATERIAL, 2)} language="en" />);
    expect(container.querySelector('svg')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    const text = container.querySelector('figure > div')!;
    expect(text.textContent).toBe('# Regras\n\n<b>negrito</b>');
    expect(text.getAttribute('class')).toMatch(/text/);
    expect(container.querySelector('figure')!.getAttribute('data-kind')).toBe('text');
    expect(screen.getByText('Page 2 of 9')).toBeTruthy();
    expectNoStyleAttribute(container);
  });

  it('builds the relayed picture URL, and draws a line with no width without stretching it', () => {
    expect(pictureUrl(MATERIAL, 7)).toBe(`/api/v1/materials/${MATERIAL}/pages/7/picture?ground=review`);
    const page = { ...picturePage, lines: [{ text: 'x', box: [0.5, 0.5, 0.5, 0.5] }] };
    const { container } = render(<PageView page={page} pictureSrc={pictureUrl(MATERIAL, 13)} language="pt-BR" />);
    const text = container.querySelector('text')!;
    expect(text.getAttribute('textLength')).toBeNull();
    expect(text.getAttribute('font-size')).toBe('0.9');
  });
});

describe('PageView marks the cited passages (Story 2.7)', () => {
  const CITED = '0190a0b0-0000-7000-8000-000000000009';
  const OTHER = '0190a0b0-0000-7000-8000-00000000000b';
  const SRC = '/api/v1/turns/0190a0b0-0000-7000-8000-000000000021/references/1/pages/13/picture';
  const picturePage = {
    page: 13,
    pageTotal: 364,
    picture: { width: 1000, height: 2000 },
    lines: [
      { text: 'Armor', box: [0.1, 0.05, 0.3, 0.07] },
      { text: 'Fire Bolt', box: [0.1, 0.2, 0.5, 0.22] },
      { text: '1d10 fire damage', box: [0.1, 0.23, 0.6, 0.25] },
      { text: 'Plate | 1,500 gp', box: [0.1, 0.5, 0.6, 0.52] },
    ],
    text: null,
    passages: [
      { id: CITED, boxes: [[0.1, 0.19, 0.7, 0.26]] },
      { id: OTHER, boxes: [[0.1, 0.49, 0.7, 0.53]] },
    ],
    outcome: 'read_directly',
  };

  it('draws each box of a cited passage as a rect under the passage mark, and groups its lines as the cited passage', () => {
    const { container } = render(<PageView page={picturePage} pictureSrc={SRC} language="pt-BR" cited={[CITED]} />);
    const svg = container.querySelector('svg')!;
    expect(svg.querySelector('image')!.getAttribute('href')).toBe(SRC);
    const marks = [...svg.querySelectorAll('rect')].filter((rect) => /passage/.test(rect.getAttribute('class') ?? ''));
    expect(marks).toHaveLength(1);
    expect(marks[0]!.getAttribute('x')).toBe('100');
    expect(marks[0]!.getAttribute('y')).toBe('380');
    expect(marks[0]!.getAttribute('width')).toBe('600');
    expect(marks[0]!.getAttribute('height')).toBe('140');
    expect(marks[0]!.getAttribute('aria-hidden')).toBe('true');
    const group = screen.getByRole('group', { name: 'trecho citado' });
    expect(group.tagName.toLowerCase()).toBe('g');
    expect([...group.querySelectorAll('text')].map((text) => text.textContent)).toEqual(['Fire Bolt', '1d10 fire damage']);
    // Every line keeps its reading order; the uncited ones stand alone.
    expect([...svg.querySelectorAll('text')].map((text) => text.textContent)).toEqual(picturePage.lines.map((line) => line.text));
    expect(svg.querySelectorAll('g')).toHaveLength(1);
    expectNoStyleAttribute(container);
  });

  it('marks nothing on a page without a cited passage', () => {
    const { container } = render(<PageView page={picturePage} pictureSrc={SRC} language="en" cited={['0190a0b0-0000-7000-8000-0000000000ff']} />);
    expect([...container.querySelectorAll('svg > *')].map((child) => child.tagName.toLowerCase())).toEqual(['rect', 'image', 'text', 'text', 'text', 'text']);
    expect(screen.queryByRole('group', { name: 'cited passage' })).toBeNull();
    cleanup();
    const text = { page: 2, pageTotal: 3, picture: null, lines: [], text: 'Fire Bolt.', passages: [{ id: OTHER, range: [0, 4] }], outcome: null };
    const { container: plain } = render(<PageView page={text} pictureSrc={SRC} language="en" cited={[CITED]} />);
    expect(plain.querySelector('mark')).toBeNull();
    expect(plain.querySelector('figure > div')!.textContent).toBe('Fire Bolt.');
  });

  it('wraps the code-point range of each cited passage of a text page in a mark announced as the cited passage', () => {
    // An emoji is one code point and two UTF-16 units: ranges count code points, as the backend does.
    const text = '🔥 Fire Bolt: 1d10. <b>Plate</b> AC 18.';
    const page = {
      page: 2,
      pageTotal: 3,
      picture: null,
      lines: [],
      text,
      passages: [
        { id: CITED, range: [2, 18] },
        { id: OTHER, range: [19, 31] },
      ],
      outcome: 'read_directly',
    };
    const { container } = render(<PageView page={page} pictureSrc={SRC} language="en" cited={[CITED]} />);
    const marks = [...container.querySelectorAll('mark')];
    expect(marks.map((mark) => mark.textContent)).toEqual(['Fire Bolt: 1d10.']);
    expect(marks[0]!.getAttribute('class')).toMatch(/mark/);
    expect(screen.getByRole('group', { name: 'cited passage' }).firstElementChild).toBe(marks[0]);
    const block = container.querySelector('figure > div')!;
    expect(block.textContent).toBe(text);
    expect(block.querySelector('b')).toBeNull();
    cleanup();
    // Two cited passages that overlap become one mark.
    const both = { ...page, passages: [{ id: CITED, range: [2, 12] }, { id: OTHER, range: [8, 18] }] };
    const { container: merged } = render(<PageView page={both} pictureSrc={SRC} language="pt-BR" cited={[CITED, OTHER]} />);
    expect([...merged.querySelectorAll('mark')].map((mark) => mark.textContent)).toEqual(['Fire Bolt: 1d10.']);
    expect(screen.getAllByRole('group', { name: 'trecho citado' })).toHaveLength(1);
    expectNoStyleAttribute(merged);
  });
});

describe('MaterialActions (Story 1.20)', () => {
  const ID = '0190a0b0-0000-7000-8000-000000000003';
  type State = { readonly error: string | null };
  const recorder = (answer: State = { error: null }) => {
    const posted: Record<string, string>[] = [];
    const action = vi.fn(async (_previous: State, form: FormData) => {
      posted.push(Object.fromEntries([...form.entries()].map(([key, value]) => [key, String(value)])));
      return answer;
    });
    return { posted, action };
  };

  it('shows only the actions it is given, Aceitar the one solid pill, and posts the chosen one with the id', async () => {
    const user = userEvent.setup();
    const { posted, action } = recorder();
    const { container, rerender } = render(
      <MaterialActions id={ID} name="Livro.pdf" actions={['accept', 'reprocess', 'discard']} pages={444} language="pt-BR" action={action} />,
    );
    const pills = within(container.querySelector('form')!).getAllByRole('button');
    expect(pills.map((pill) => `${pill.textContent}:${pill.dataset.variant}`)).toEqual([
      'Aceitar:solid',
      'Reprocessar páginas com falha:default',
      'Descartar:danger',
    ]);
    // From the keyboard: Tab to Aceitar, Enter posts it.
    await user.tab();
    expect(document.activeElement).toBe(pills[0]);
    await user.keyboard('{Enter}');
    await vi.waitFor(() => expect(posted).toEqual([{ id: ID, action: 'accept' }]));
    await user.click(screen.getByRole('button', { name: 'Reprocessar páginas com falha' }));
    await vi.waitFor(() => expect(posted.at(-1)).toEqual({ id: ID, action: 'reprocess' }));

    rerender(<MaterialActions id={ID} name="Livro.pdf" actions={['retry', 'discard']} pages={undefined} language="en" action={action} />);
    expect(within(container.querySelector('form')!).getAllByRole('button').map((pill) => `${pill.textContent}:${pill.dataset.variant}`)).toEqual([
      'Try again:solid',
      'Discard:danger',
    ]);
    rerender(<MaterialActions id={ID} name="Livro.pdf" actions={[]} pages={444} language="en" action={action} />);
    expect(container.querySelector('form')).toBeNull();
    expectNoStyleAttribute(container);
  });

  it('a ready material shows "Substituir" and "Reprocessar", two plain pills; Reprocessar posts at once, with no confirmation (Story 3.4)', async () => {
    const user = userEvent.setup();
    const { posted, action } = recorder();
    const { container, rerender } = render(
      <MaterialActions id={ID} name="Livro.pdf" actions={['reprocess']} pages={444} ready language="pt-BR" action={action} />,
    );
    const pills = within(container.querySelector('form')!).getAllByRole('button');
    expect(pills.map((pill) => `${pill.textContent}:${pill.dataset.variant}`)).toEqual(['Substituir:default', 'Reprocessar:default']);
    expect(pills[0]!.getAttribute('aria-haspopup')).toBe('dialog');
    // Outside the shell there is no guided upload to open: nothing is posted.
    await user.click(pills[0]!);
    expect(posted).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Reprocessar' }));
    await vi.waitFor(() => expect(posted).toEqual([{ id: ID, action: 'reprocess' }]));
    expect(container.querySelector('dialog')).toBeNull();
    rerender(<MaterialActions id={ID} name="Livro.pdf" actions={['reprocess']} pages={444} ready language="en" action={action} />);
    expect(within(container.querySelector('form')!).getAllByRole('button').map((pill) => pill.textContent)).toEqual(['Replace', 'Reprocess']);
    // A ready material whose backend offers no action still offers its replacement.
    rerender(<MaterialActions id={ID} name="Livro.pdf" actions={[]} pages={444} ready language="pt-BR" action={action} />);
    expect(within(container.querySelector('form')!).getAllByRole('button').map((pill) => pill.textContent)).toEqual(['Substituir']);
    expectNoStyleAttribute(container);
  });

  it('Descartar opens a confirmation naming what goes, with its count; Esc keeps everything, the danger pill discards', async () => {
    const user = userEvent.setup();
    const { posted, action } = recorder();
    const { container } = render(
      <MaterialActions id={ID} name="Livro do Jogador.pdf" actions={['accept', 'discard']} pages={444} language="pt-BR" action={action} />,
    );
    const opener = screen.getByRole('button', { name: 'Descartar' });
    // From the keyboard: Tab past Aceitar to Descartar, Enter opens the dialog.
    await user.tab();
    await user.tab();
    expect(document.activeElement).toBe(opener);
    await user.keyboard('{Enter}');
    const dialog = screen.getByRole('dialog', { name: 'Descartar «Livro do Jogador.pdf»?' });
    expect(dialog.textContent).toContain('Saem as 444 páginas lidas deste arquivo, com suas imagens e o texto extraído, o sumário e o arquivo enviado.');
    await user.keyboard('{Escape}');
    expect(container.querySelector('dialog')?.open).toBe(false);
    expect(document.activeElement).toBe(opener);
    expect(posted).toEqual([]);

    await user.click(opener);
    const confirm = within(screen.getByRole('dialog')).getByRole('button', { name: 'Descartar' });
    expect(confirm.dataset.variant).toBe('danger');
    await user.click(confirm);
    await vi.waitFor(() => expect(posted).toEqual([{ id: ID, action: 'discard' }]));
    expect(container.querySelector('dialog')?.open).toBe(false);
  });

  it('names one page, or only the uploaded file of a version with no page read, in both languages', async () => {
    const user = userEvent.setup();
    const { action } = recorder();
    const { rerender } = render(<MaterialActions id={ID} name="Um.pdf" actions={['discard']} pages={1} language="pt-BR" action={action} />);
    await user.click(screen.getByRole('button', { name: 'Descartar' }));
    expect(screen.getByRole('dialog').textContent).toContain('Sai a página lida deste arquivo');
    await user.keyboard('{Escape}');
    rerender(<MaterialActions id={ID} name="Fechado.pdf" actions={['discard']} pages={undefined} language="en" action={action} />);
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(screen.getByRole('dialog', { name: 'Discard «Fechado.pdf»?' }).textContent).toContain(
      'The uploaded file goes, with everything read from it.',
    );
  });

  it('shows a refusal as an alert under the pills', async () => {
    const user = userEvent.setup();
    const { action } = recorder({ error: 'Esta ação não está disponível no estado atual do material. A página foi atualizada.' });
    render(<MaterialActions id={ID} name="Livro.pdf" actions={['accept', 'discard']} pages={2} language="pt-BR" action={action} />);
    await user.click(screen.getByRole('button', { name: 'Aceitar' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Esta ação não está disponível no estado atual do material. A página foi atualizada.');
  });
});

describe('SystemActions (Story 3.1 part B)', () => {
  const ID = '0190a0b0-0000-7000-8000-000000000030';
  type State = { readonly error: string | null };
  const recorder = (answer: State = { error: null }) => {
    const posted: Record<string, string>[] = [];
    const action = vi.fn(async (_previous: State, form: FormData) => {
      posted.push(Object.fromEntries([...form.entries()].map(([key, value]) => [key, String(value)])));
      return answer;
    });
    return { posted, action };
  };

  it('Excluir is a danger pill that opens the confirmation with the counts; Cancelar or Esc closes it and focus goes back', async () => {
    const user = userEvent.setup();
    const { posted, action } = recorder();
    const { container } = render(
      <SystemActions id={ID} counts={{ campaigns: 2, conversations: 3, materials: 1, artifacts: 4 }} language="pt-BR" action={action} />,
    );
    const opener = screen.getByRole('button', { name: 'Excluir' });
    expect(opener.dataset.variant).toBe('danger');
    expect(opener.getAttribute('aria-haspopup')).toBe('dialog');
    // From the keyboard: Tab to Excluir, Enter opens the dialog.
    await user.tab();
    expect(document.activeElement).toBe(opener);
    await user.keyboard('{Enter}');
    const dialog = screen.getByRole('dialog', { name: 'Excluir este sistema?' });
    expect(dialog.textContent).toContain(
      'Vão junto: 2 campanhas, 3 conversas, 1 material ligado só a ele e 4 artefatos. Isso não pode ser desfeito.',
    );
    await user.keyboard('{Escape}');
    expect(container.querySelector('dialog')?.open).toBe(false);
    expect(document.activeElement).toBe(opener);

    await user.click(opener);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar' }));
    expect(container.querySelector('dialog')?.open).toBe(false);
    expect(document.activeElement).toBe(opener);
    expect(posted).toEqual([]);

    await user.click(opener);
    const confirm = within(screen.getByRole('dialog')).getByRole('button', { name: 'Excluir sistema' });
    expect(confirm.dataset.variant).toBe('danger');
    await user.click(confirm);
    await vi.waitFor(() => expect(posted).toEqual([{ id: ID }]));
    expect(container.querySelector('dialog')?.open).toBe(false);
    expectNoStyleAttribute(container);
  });

  it('names one of each, none, and what goes in words when the counts are missing, in both languages', async () => {
    const user = userEvent.setup();
    const { action } = recorder();
    const { rerender } = render(
      <SystemActions id={ID} counts={{ campaigns: 1, conversations: 1, materials: 1, artifacts: 1 }} language="pt-BR" action={action} />,
    );
    await user.click(screen.getByRole('button', { name: 'Excluir' }));
    expect(screen.getByRole('dialog').textContent).toContain('Vão junto: 1 campanha, 1 conversa, 1 material ligado só a ele e 1 artefato.');
    await user.keyboard('{Escape}');
    rerender(<SystemActions id={ID} counts={{ campaigns: 0, conversations: 0, materials: 0, artifacts: 0 }} language="en" action={action} />);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete this system?' });
    expect(dialog.textContent).toContain(
      'Going with it: 0 campaigns, 0 conversations, 0 materials linked only to it and 0 artifacts. This cannot be undone.',
    );
    expect(within(dialog).getByRole('button', { name: 'Delete system' })).toBeTruthy();
    await user.keyboard('{Escape}');
    rerender(<SystemActions id={ID} counts={null} language="pt-BR" action={action} />);
    await user.click(screen.getByRole('button', { name: 'Excluir' }));
    expect(screen.getByRole('dialog').textContent).toContain(
      'Vão junto as campanhas deste sistema, as conversas e os artefatos delas e os materiais ligados só a ele.',
    );
  });

  it('shows a refusal as an alert under the pill, with focus back on "Excluir"', async () => {
    const user = userEvent.setup();
    const { action } = recorder({ error: 'Não encontrado.' });
    render(<SystemActions id={ID} counts={{ campaigns: 1, conversations: 0, materials: 0, artifacts: 0 }} language="pt-BR" action={action} />);
    const opener = screen.getByRole('button', { name: 'Excluir' });
    await user.click(opener);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Excluir sistema' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Não encontrado.');
    expect(document.activeElement).toBe(opener);
    expect(opener.hasAttribute('disabled')).toBe(false);
  });
});

describe('CampaignDeleteAction (Story 3.2 part B)', () => {
  const ID = '0190a0b0-0000-7000-8000-000000000040';
  type State = { readonly error: string | null };
  const recorder = (answer: State = { error: null }) => {
    const posted: Record<string, string>[] = [];
    const action = vi.fn(async (_previous: State, form: FormData) => {
      posted.push(Object.fromEntries([...form.entries()].map(([key, value]) => [key, String(value)])));
      return answer;
    });
    return { posted, action };
  };

  it('Excluir is a danger pill that opens the confirmation with the counts; Cancelar or Esc closes it and focus goes back', async () => {
    const user = userEvent.setup();
    const { posted, action } = recorder();
    const { container } = render(<CampaignDeleteAction id={ID} counts={{ conversations: 3, materials: 2, artifacts: 5 }} language="pt-BR" action={action} />);
    const opener = screen.getByRole('button', { name: 'Excluir' });
    expect(opener.dataset.variant).toBe('danger');
    expect(opener.getAttribute('aria-haspopup')).toBe('dialog');
    // From the keyboard: Tab to Excluir, Enter opens the dialog.
    await user.tab();
    expect(document.activeElement).toBe(opener);
    await user.keyboard('{Enter}');
    const dialog = screen.getByRole('dialog', { name: 'Excluir esta campanha?' });
    expect(dialog.textContent).toContain('Vão junto: 3 conversas, 2 materiais e 5 artefatos desta campanha. Isso não pode ser desfeito.');
    await user.keyboard('{Escape}');
    expect(container.querySelector('dialog')?.open).toBe(false);
    expect(document.activeElement).toBe(opener);

    await user.click(opener);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar' }));
    expect(container.querySelector('dialog')?.open).toBe(false);
    expect(document.activeElement).toBe(opener);
    expect(posted).toEqual([]);

    await user.click(opener);
    const confirm = within(screen.getByRole('dialog')).getByRole('button', { name: 'Excluir campanha' });
    expect(confirm.dataset.variant).toBe('danger');
    await user.click(confirm);
    await vi.waitFor(() => expect(posted).toEqual([{ id: ID }]));
    expect(container.querySelector('dialog')?.open).toBe(false);
    expectNoStyleAttribute(container);
  });

  it('names one of each, none, and what goes in words when the counts are missing, in both languages', async () => {
    const user = userEvent.setup();
    const { action } = recorder();
    const { rerender } = render(<CampaignDeleteAction id={ID} counts={{ conversations: 1, materials: 1, artifacts: 1 }} language="pt-BR" action={action} />);
    await user.click(screen.getByRole('button', { name: 'Excluir' }));
    expect(screen.getByRole('dialog').textContent).toContain('Vão junto: 1 conversa, 1 material e 1 artefato desta campanha.');
    await user.keyboard('{Escape}');
    rerender(<CampaignDeleteAction id={ID} counts={{ conversations: 0, materials: 0, artifacts: 0 }} language="en" action={action} />);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete this campaign?' });
    expect(dialog.textContent).toContain('Going with it: 0 conversations, 0 materials and 0 artifacts of this campaign. This cannot be undone.');
    expect(within(dialog).getByRole('button', { name: 'Delete campaign' })).toBeTruthy();
    await user.keyboard('{Escape}');
    rerender(<CampaignDeleteAction id={ID} counts={{ conversations: 1, materials: 4, artifacts: 1 }} language="en" action={action} />);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByRole('dialog').textContent).toContain('Going with it: 1 conversation, 4 materials and 1 artifact of this campaign.');
    await user.keyboard('{Escape}');
    rerender(<CampaignDeleteAction id={ID} counts={null} language="pt-BR" action={action} />);
    await user.click(screen.getByRole('button', { name: 'Excluir' }));
    expect(screen.getByRole('dialog').textContent).toContain('Vão junto as conversas, os materiais e os artefatos desta campanha. Isso não pode ser desfeito.');
    await user.keyboard('{Escape}');
    rerender(<CampaignDeleteAction id={ID} counts={null} language="en" action={action} />);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByRole('dialog').textContent).toContain("Going with it: this campaign's conversations, materials and artifacts. This cannot be undone.");
  });

  it('"Excluir" ignores clicks while the delete runs, and takes them again once it ends', async () => {
    const user = userEvent.setup();
    let finish: (state: State) => void = () => undefined;
    const action = vi.fn(
      () =>
        new Promise<State>((resolve) => {
          finish = resolve;
        }),
    );
    const { container } = render(<CampaignDeleteAction id={ID} counts={{ conversations: 1, materials: 0, artifacts: 0 }} language="pt-BR" action={action} />);
    const opener = screen.getByRole('button', { name: 'Excluir' });
    await user.click(opener);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Excluir campanha' }));
    await vi.waitFor(() => expect(opener.getAttribute('aria-disabled')).toBe('true'));
    await user.click(opener);
    expect(container.querySelector('dialog')?.open).toBe(false);
    expect(action).toHaveBeenCalledTimes(1);

    await act(async () => finish({ error: null }));
    await vi.waitFor(() => expect(opener.getAttribute('aria-disabled')).toBe('false'));
    await user.click(opener);
    expect(container.querySelector('dialog')?.open).toBe(true);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('shows a refusal as an alert under the pill, with focus back on "Excluir"', async () => {
    const user = userEvent.setup();
    const { action } = recorder({ error: 'Não encontrado.' });
    render(<CampaignDeleteAction id={ID} counts={{ conversations: 1, materials: 0, artifacts: 0 }} language="pt-BR" action={action} />);
    const opener = screen.getByRole('button', { name: 'Excluir' });
    await user.click(opener);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Excluir campanha' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Não encontrado.');
    expect(document.activeElement).toBe(opener);
    expect(opener.hasAttribute('disabled')).toBe(false);
  });
});

describe('ShieldDeleteAction (Story 6.1 part B)', () => {
  const CAMPAIGN = '0190a0b0-0000-7000-8000-000000000002';
  const SHIELD = '0190a0b0-0000-7000-8000-000000000a02';
  type State = { readonly error: string | null };
  const recorder = (answer: State = { error: null }) => {
    const posted: Record<string, string>[] = [];
    const action = vi.fn(async (_previous: State, form: FormData) => {
      posted.push(Object.fromEntries([...form.entries()].map(([key, value]) => [key, String(value)])));
      return answer;
    });
    return { posted, action };
  };
  const props = { campaignId: CAMPAIGN, shieldId: SHIELD, name: 'Combate' } as const;
  const EMPTY = { notes: 0, rolls: 0, last: false } as const;

  it('Excluir is a danger pill that opens the confirmation saying the Shield is empty; Esc or Cancelar closes it and focus goes back', async () => {
    const user = userEvent.setup();
    const { posted, action } = recorder();
    const { container } = render(<ShieldDeleteAction {...props} deletion={EMPTY} language="pt-BR" action={action} />);
    const opener = screen.getByRole('button', { name: 'Excluir' });
    expect(opener.dataset.variant).toBe('danger');
    expect(opener.getAttribute('aria-haspopup')).toBe('dialog');
    // From the keyboard: Tab to Excluir, Enter opens the dialog, focus starts on "Cancelar".
    await user.tab();
    expect(document.activeElement).toBe(opener);
    await user.keyboard('{Enter}');
    const dialog = screen.getByRole('dialog', { name: 'Excluir «Combate»?' });
    expect(dialog.textContent).toContain('O escudo está vazio.');
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Cancelar' }));
    await user.keyboard('{Escape}');
    expect(container.querySelector('dialog')?.open).toBe(false);
    expect(document.activeElement).toBe(opener);

    await user.click(opener);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar' }));
    expect(container.querySelector('dialog')?.open).toBe(false);
    expect(document.activeElement).toBe(opener);
    expect(posted).toEqual([]);

    await user.click(opener);
    const confirm = within(screen.getByRole('dialog')).getByRole('button', { name: 'Excluir escudo' });
    expect(confirm.dataset.variant).toBe('danger');
    await user.click(confirm);
    await vi.waitFor(() => expect(posted).toEqual([{ campaign: CAMPAIGN, id: SHIELD }]));
    expect(container.querySelector('dialog')?.open).toBe(false);
    expect(screen.queryByRole('alert')).toBeNull();
    expectNoStyleAttribute(container);
  });

  it('names the notes and rolls that go with their counts, one and other, and in words when the preview is missing, in both languages', async () => {
    const user = userEvent.setup();
    const { action } = recorder();
    const { rerender } = render(<ShieldDeleteAction {...props} deletion={{ notes: 1, rolls: 1, last: false }} language="pt-BR" action={action} />);
    await user.click(screen.getByRole('button', { name: 'Excluir' }));
    expect(screen.getByRole('dialog').textContent).toContain('Vão junto: 1 nota e 1 rolagem deste escudo. Isso não pode ser desfeito.');
    await user.keyboard('{Escape}');
    rerender(<ShieldDeleteAction {...props} deletion={{ notes: 3, rolls: 0, last: false }} language="pt-BR" action={action} />);
    await user.click(screen.getByRole('button', { name: 'Excluir' }));
    expect(screen.getByRole('dialog').textContent).toContain('Vão junto: 3 notas e 0 rolagens deste escudo.');
    await user.keyboard('{Escape}');
    rerender(<ShieldDeleteAction {...props} deletion={{ notes: 1, rolls: 12, last: false }} language="en" action={action} />);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete «Combate»?' });
    expect(dialog.textContent).toContain('Going with it: 1 note and 12 rolls of this Shield. This cannot be undone.');
    expect(within(dialog).getByRole('button', { name: 'Delete Shield' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeTruthy();
    await user.keyboard('{Escape}');
    rerender(<ShieldDeleteAction {...props} deletion={EMPTY} language="en" action={action} />);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByRole('dialog').textContent).toContain('The Shield is empty.');
    await user.keyboard('{Escape}');
    rerender(<ShieldDeleteAction {...props} deletion={null} language="pt-BR" action={action} />);
    await user.click(screen.getByRole('button', { name: 'Excluir' }));
    expect(screen.getByRole('dialog').textContent).toContain('Vão junto as notas e as rolagens deste escudo. Isso não pode ser desfeito.');
  });

  it('the campaign\'s only Shield: a press opens no dialog and says why in an alert, posting nothing', async () => {
    const user = userEvent.setup();
    const { posted, action } = recorder();
    const { container, rerender } = render(<ShieldDeleteAction {...props} deletion={{ ...EMPTY, last: true }} language="pt-BR" action={action} />);
    const opener = screen.getByRole('button', { name: 'Excluir' });
    expect(opener.dataset.variant).toBe('danger');
    expect(opener.hasAttribute('aria-haspopup')).toBe(false);
    expect(screen.queryByRole('alert')).toBeNull();
    await user.tab();
    await user.keyboard('{Enter}');
    expect(container.querySelector('dialog')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('alert').textContent).toBe('Uma campanha precisa de pelo menos um escudo.');
    expect(document.activeElement).toBe(opener);
    await user.click(opener);
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(posted).toEqual([]);
    expect(action).not.toHaveBeenCalled();
    rerender(<ShieldDeleteAction {...props} deletion={{ ...EMPTY, last: true }} language="en" action={action} />);
    expect(screen.getByRole('alert').textContent).toBe('A campaign needs at least one Shield.');
    expectNoStyleAttribute(container);
  });

  it('"Excluir" ignores clicks while the delete runs, and a refusal (the last Shield, meanwhile) shows as an alert with focus back on it', async () => {
    const user = userEvent.setup();
    let finish: (state: State) => void = () => undefined;
    const action = vi.fn(
      () =>
        new Promise<State>((resolve) => {
          finish = resolve;
        }),
    );
    const { container } = render(<ShieldDeleteAction {...props} deletion={EMPTY} language="pt-BR" action={action} />);
    const opener = screen.getByRole('button', { name: 'Excluir' });
    await user.click(opener);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Excluir escudo' }));
    await vi.waitFor(() => expect(opener.getAttribute('aria-disabled')).toBe('true'));
    await user.click(opener);
    expect(container.querySelector('dialog')?.open).toBe(false);
    expect(action).toHaveBeenCalledTimes(1);

    await act(async () => finish({ error: 'Uma campanha precisa de pelo menos um escudo.' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Uma campanha precisa de pelo menos um escudo.');
    await vi.waitFor(() => expect(opener.getAttribute('aria-disabled')).toBe('false'));
    expect(document.activeElement).toBe(opener);
    expect(opener.hasAttribute('disabled')).toBe(false);
  });
});

describe('ArtifactDeleteAction (Story 5.2 part B)', () => {
  const CAMPAIGN = '0190a0b0-0000-7000-8000-000000000002';
  const ARTIFACT = '0190a0b0-0000-7000-8000-000000000900';
  type State = { readonly error: string | null };
  const recorder = (answer: State = { error: null }) => {
    const posted: Record<string, string>[] = [];
    const action = vi.fn(async (_previous: State, form: FormData) => {
      posted.push(Object.fromEntries([...form.entries()].map(([key, value]) => [key, String(value)])));
      return answer;
    });
    return { posted, action };
  };
  const props = { campaignId: CAMPAIGN, artifactId: ARTIFACT, name: 'Espada de Kael' } as const;

  it('Excluir is a danger pill that opens the confirmation naming the artifact; Esc or Cancelar closes it; confirming posts it', async () => {
    const user = userEvent.setup();
    const { posted, action } = recorder();
    const { container } = render(<ArtifactDeleteAction {...props} from="characters" language="pt-BR" action={action} />);
    const opener = screen.getByRole('button', { name: 'Excluir' });
    expect(opener.dataset.variant).toBe('danger');
    expect(opener.getAttribute('aria-haspopup')).toBe('dialog');
    // From the keyboard: Tab to Excluir, Enter opens the dialog, focus starts on "Cancelar".
    await user.tab();
    expect(document.activeElement).toBe(opener);
    await user.keyboard('{Enter}');
    const dialog = screen.getByRole('dialog', { name: 'Excluir «Espada de Kael»?' });
    expect(dialog.textContent).toContain('Todas as versões deste artefato vão junto. As respostas que o citaram mostram «fonte removida». Isso não pode ser desfeito.');
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Cancelar' }));
    await user.keyboard('{Escape}');
    expect(container.querySelector('dialog')?.open).toBe(false);
    expect(document.activeElement).toBe(opener);

    await user.click(opener);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar' }));
    expect(container.querySelector('dialog')?.open).toBe(false);
    expect(document.activeElement).toBe(opener);
    expect(posted).toEqual([]);

    await user.click(opener);
    const confirm = within(screen.getByRole('dialog')).getByRole('button', { name: 'Excluir artefato' });
    expect(confirm.dataset.variant).toBe('danger');
    await user.click(confirm);
    await vi.waitFor(() => expect(posted).toEqual([{ campaignId: CAMPAIGN, artifactId: ARTIFACT, name: 'Espada de Kael', from: 'characters' }]));
    expect(container.querySelector('dialog')?.open).toBe(false);
    expectNoStyleAttribute(container);
  });

  it('posts no `from` when the page was not opened from "Personagens", and reads in English', async () => {
    const user = userEvent.setup();
    const { posted, action } = recorder();
    render(<ArtifactDeleteAction {...props} from={null} language="en" action={action} />);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete «Espada de Kael»?' });
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Delete artifact' }));
    await vi.waitFor(() => expect(posted).toEqual([{ campaignId: CAMPAIGN, artifactId: ARTIFACT, name: 'Espada de Kael' }]));
  });

  it('Story 5.6 part B: a shared artifact\'s consequence adds the campaigns it also leaves, in the order given, in both languages', async () => {
    const user = userEvent.setup();
    const { action } = recorder();
    const { rerender } = render(
      <ArtifactDeleteAction {...props} from={null} language="pt-BR" action={action} sharedWith={['Mesa de quinta', 'Mesa de domingo']} />,
    );
    await user.click(screen.getByRole('button', { name: 'Excluir' }));
    expect(screen.getByRole('dialog').textContent).toContain(
      'Todas as versões deste artefato vão junto. Também sai de: Mesa de quinta e Mesa de domingo. As respostas que o citaram mostram «fonte removida». Isso não pode ser desfeito.',
    );
    await user.keyboard('{Escape}');
    rerender(<ArtifactDeleteAction {...props} from={null} language="en" action={action} sharedWith={['Mesa de quinta']} />);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByRole('dialog').textContent).toContain('It also leaves: Mesa de quinta. Answers that cited it show «source removed». This cannot be undone.');
    await user.keyboard('{Escape}');
    rerender(<ArtifactDeleteAction {...props} from={null} language="en" action={action} sharedWith={[]} />);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByRole('dialog').textContent).not.toContain('It also leaves');
  });

  it('"Excluir" ignores clicks while the delete runs, and takes them again once it ends', async () => {
    const user = userEvent.setup();
    let finish: (state: State) => void = () => undefined;
    const action = vi.fn(
      () =>
        new Promise<State>((resolve) => {
          finish = resolve;
        }),
    );
    const { container } = render(<ArtifactDeleteAction {...props} from={null} language="pt-BR" action={action} />);
    const opener = screen.getByRole('button', { name: 'Excluir' });
    await user.click(opener);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Excluir artefato' }));
    await vi.waitFor(() => expect(opener.getAttribute('aria-disabled')).toBe('true'));
    await user.click(opener);
    expect(container.querySelector('dialog')?.open).toBe(false);
    expect(action).toHaveBeenCalledTimes(1);

    await act(async () => finish({ error: null }));
    await vi.waitFor(() => expect(opener.getAttribute('aria-disabled')).toBe('false'));
    await user.click(opener);
    expect(container.querySelector('dialog')?.open).toBe(true);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('shows a refusal as an alert under the pill, with focus back on "Excluir"', async () => {
    const user = userEvent.setup();
    const { action } = recorder({ error: 'O pedido não é válido.' });
    render(<ArtifactDeleteAction {...props} from={null} language="pt-BR" action={action} />);
    const opener = screen.getByRole('button', { name: 'Excluir' });
    await user.click(opener);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Excluir artefato' }));
    expect((await screen.findByRole('alert')).textContent).toBe('O pedido não é válido.');
    expect(document.activeElement).toBe(opener);
    expect(opener.hasAttribute('disabled')).toBe(false);
  });
});

describe('ConversationDeleteAction (Story 3.10 part B)', () => {
  const ID = '0190a0b0-0000-7000-8000-000000000020';
  type State = { readonly error: string | null };
  const recorder = (answer: State = { error: null }) => {
    const posted: Record<string, string>[] = [];
    const action = vi.fn(async (_previous: State, form: FormData) => {
      posted.push(Object.fromEntries([...form.entries()].map(([key, value]) => [key, String(value)])));
      return answer;
    });
    return { posted, action };
  };

  it('Excluir is a danger pill that opens the confirmation with the count, focus on Cancelar; "Excluir conversa" posts the conversation', async () => {
    const user = userEvent.setup();
    const { posted, action } = recorder();
    const { container } = render(<ConversationDeleteAction id={ID} questions={3} language="pt-BR" action={action} />);
    const opener = screen.getByRole('button', { name: 'Excluir' });
    expect(opener.dataset.variant).toBe('danger');
    expect(opener.getAttribute('aria-haspopup')).toBe('dialog');
    await user.tab();
    await user.keyboard('{Enter}');
    const dialog = screen.getByRole('dialog', { name: 'Excluir esta conversa?' });
    expect(dialog.textContent).toContain('Vão junto: 3 perguntas e suas respostas. Isso não pode ser desfeito.');
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Cancelar' }));
    await user.keyboard('{Escape}');
    expect(container.querySelector('dialog')?.open).toBe(false);
    expect(document.activeElement).toBe(opener);
    expect(posted).toEqual([]);

    await user.click(opener);
    const confirm = within(screen.getByRole('dialog')).getByRole('button', { name: 'Excluir conversa' });
    expect(confirm.dataset.variant).toBe('danger');
    await user.click(confirm);
    await vi.waitFor(() => expect(posted).toEqual([{ id: ID }]));
    expect(container.querySelector('dialog')?.open).toBe(false);
    expectNoStyleAttribute(container);
  });

  it('names one question, none, and what goes in words when no count was read, in both languages', async () => {
    const user = userEvent.setup();
    const { action } = recorder();
    const { rerender } = render(<ConversationDeleteAction id={ID} questions={1} language="pt-BR" action={action} />);
    await user.click(screen.getByRole('button', { name: 'Excluir' }));
    expect(screen.getByRole('dialog').textContent).toContain('Vai junto: 1 pergunta e sua resposta. Isso não pode ser desfeito.');
    await user.keyboard('{Escape}');
    rerender(<ConversationDeleteAction id={ID} questions={0} language="en" action={action} />);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete this conversation?' });
    expect(dialog.textContent).toContain('Going with it: 0 questions and their answers. This cannot be undone.');
    expect(within(dialog).getByRole('button', { name: 'Delete conversation' })).toBeTruthy();
    await user.keyboard('{Escape}');
    rerender(<ConversationDeleteAction id={ID} questions={1} language="en" action={action} />);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByRole('dialog').textContent).toContain('Going with it: 1 question and its answer. This cannot be undone.');
    await user.keyboard('{Escape}');
    rerender(<ConversationDeleteAction id={ID} questions={null} language="pt-BR" action={action} />);
    await user.click(screen.getByRole('button', { name: 'Excluir' }));
    expect(screen.getByRole('dialog').textContent).toContain('Vão junto: as perguntas desta conversa e suas respostas. Isso não pode ser desfeito.');
    await user.keyboard('{Escape}');
    rerender(<ConversationDeleteAction id={ID} questions={null} language="en" action={action} />);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByRole('dialog').textContent).toContain("Going with it: this conversation's questions and their answers. This cannot be undone.");
  });

  it('"Excluir" ignores clicks while the delete runs; a refusal shows as an alert under it, with focus back on it', async () => {
    const user = userEvent.setup();
    let finish: (state: State) => void = () => undefined;
    const action = vi.fn(
      () =>
        new Promise<State>((resolve) => {
          finish = resolve;
        }),
    );
    const { container } = render(<ConversationDeleteAction id={ID} questions={2} language="pt-BR" action={action} />);
    const opener = screen.getByRole('button', { name: 'Excluir' });
    await user.click(opener);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Excluir conversa' }));
    await vi.waitFor(() => expect(opener.getAttribute('aria-disabled')).toBe('true'));
    await user.click(opener);
    expect(container.querySelector('dialog')?.open).toBe(false);
    expect(action).toHaveBeenCalledTimes(1);

    await act(async () => finish({ error: 'Não encontrado.' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Não encontrado.');
    await vi.waitFor(() => expect(opener.getAttribute('aria-disabled')).toBe('false'));
    expect(document.activeElement).toBe(opener);
  });
});

describe('ConversationDeleteAction with saved artifacts (Story 5.4 part B)', () => {
  const ID = '0190a0b0-0000-7000-8000-000000000020';
  const CRIPTA = '0190a0b0-0000-7000-8000-000000000903';
  const TROLL = '0190a0b0-0000-7000-8000-000000000904';
  const ARTIFACTS = [
    { id: CRIPTA, name: 'Cripta', typeLabel: 'Encontro' },
    { id: TROLL, name: 'Troll', typeLabel: 'Criatura' },
  ];
  type State = { readonly error: string | null };
  const recorder = () => {
    const posted: { id: string; artifactIds: string[] }[] = [];
    const action = vi.fn(async (_previous: State, form: FormData) => {
      posted.push({ id: String(form.get('id')), artifactIds: form.getAll('artifactIds').map(String) });
      return { error: null };
    });
    return { posted, action };
  };
  const pressed = (button: HTMLElement) => button.getAttribute('aria-pressed');

  it('with none, the plain dialog: no list, no control', async () => {
    const user = userEvent.setup();
    const { action } = recorder();
    render(<ConversationDeleteAction id={ID} questions={2} language="pt-BR" action={action} artifacts={[]} />);
    await user.click(screen.getByRole('button', { name: 'Excluir' }));
    const dialog = screen.getByRole('dialog', { name: 'Excluir esta conversa?' });
    expect(within(dialog).queryByRole('group')).toBeNull();
    expect(within(dialog).queryAllByRole('checkbox')).toEqual([]);
    expect(within(dialog).queryByRole('button', { name: 'Manter todos' })).toBeNull();
    expect(within(dialog).getAllByRole('button').map((button) => button.textContent)).toEqual(['Cancelar', 'Excluir conversa']);
  });

  it('lists them unticked, "Manter todos" pressed; ticks count in the consequence, and confirm posts the ticked ids', async () => {
    const user = userEvent.setup();
    const { posted, action } = recorder();
    const { container } = render(<ConversationDeleteAction id={ID} questions={2} language="pt-BR" action={action} artifacts={ARTIFACTS} />);
    await user.click(screen.getByRole('button', { name: 'Excluir' }));
    const dialog = screen.getByRole('dialog', { name: 'Excluir esta conversa?' });
    const list = within(dialog).getByRole('group', { name: 'Artefatos salvos desta conversa' });
    expect(list.textContent).toContain('Os marcados são excluídos com a conversa. Os outros ficam na campanha.');
    const cripta = within(list).getByRole('checkbox', { name: 'Cripta, Encontro' }) as HTMLInputElement;
    const troll = within(list).getByRole('checkbox', { name: 'Troll, Criatura' }) as HTMLInputElement;
    expect([cripta.checked, troll.checked]).toEqual([false, false]);
    expect(within(list).getAllByRole('listitem').map((row) => row.textContent)).toEqual(['CriptaEncontro', 'TrollCriatura']);
    const keepAll = within(list).getByRole('button', { name: 'Manter todos' });
    const selectAll = within(list).getByRole('button', { name: 'Selecionar todos' });
    expect([pressed(keepAll), pressed(selectAll)]).toEqual(['true', 'false']);
    expect(dialog.textContent).toContain('Vão junto: 2 perguntas e suas respostas. Isso não pode ser desfeito.');

    await user.click(cripta);
    expect([pressed(keepAll), pressed(selectAll)]).toEqual(['false', 'false']);
    expect(dialog.textContent).toContain('Vão junto: 2 perguntas e suas respostas, e 1 artefato salvo. Isso não pode ser desfeito.');
    await user.click(selectAll);
    expect([cripta.checked, troll.checked]).toEqual([true, true]);
    expect([pressed(keepAll), pressed(selectAll)]).toEqual(['false', 'true']);
    expect(dialog.textContent).toContain('Vão junto: 2 perguntas e suas respostas, e 2 artefatos salvos. Isso não pode ser desfeito.');
    await user.click(keepAll);
    expect([cripta.checked, troll.checked]).toEqual([false, false]);
    expect([pressed(keepAll), pressed(selectAll)]).toEqual(['true', 'false']);
    await user.click(cripta);

    await user.click(within(dialog).getByRole('button', { name: 'Excluir conversa' }));
    await vi.waitFor(() => expect(posted).toEqual([{ id: ID, artifactIds: [CRIPTA] }]));
    expect(container.querySelector('dialog')?.open).toBe(false);
    expectNoStyleAttribute(container);
  });

  it('keep all posts no id; select all posts both', async () => {
    const user = userEvent.setup();
    const { posted, action } = recorder();
    render(<ConversationDeleteAction id={ID} questions={1} language="pt-BR" action={action} artifacts={ARTIFACTS} />);
    const opener = screen.getByRole('button', { name: 'Excluir' });
    await user.click(opener);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Excluir conversa' }));
    await vi.waitFor(() => expect(posted).toEqual([{ id: ID, artifactIds: [] }]));
    await vi.waitFor(() => expect(opener.getAttribute('aria-disabled')).toBe('false'));
    await user.click(opener);
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Selecionar todos' }));
    expect(dialog.textContent).toContain('Vão junto: 1 pergunta e sua resposta, e 2 artefatos salvos. Isso não pode ser desfeito.');
    await user.click(within(dialog).getByRole('button', { name: 'Excluir conversa' }));
    await vi.waitFor(() => expect(posted[1]).toEqual({ id: ID, artifactIds: [CRIPTA, TROLL] }));
  });

  it('by keyboard: focus opens on Cancelar, Tab reaches every control inside the dialog, Space ticks, Esc closes back on Excluir and clears the ticks', async () => {
    const user = userEvent.setup();
    const { posted, action } = recorder();
    render(<ConversationDeleteAction id={ID} questions={null} language="pt-BR" action={action} artifacts={ARTIFACTS} />);
    const opener = screen.getByRole('button', { name: 'Excluir' });
    await user.tab();
    expect(document.activeElement).toBe(opener);
    await user.keyboard('{Enter}');
    const dialog = screen.getByRole('dialog', { name: 'Excluir esta conversa?' });
    const cancel = within(dialog).getByRole('button', { name: 'Cancelar' });
    expect(document.activeElement).toBe(cancel);
    const order: string[] = [];
    for (let step = 0; step < 6; step += 1) {
      await user.tab();
      const active = document.activeElement as HTMLElement;
      expect(dialog.contains(active)).toBe(true);
      order.push(active.getAttribute('aria-label') ?? active.textContent ?? '');
    }
    expect(order).toEqual(['Excluir conversa', 'Manter todos', 'Selecionar todos', 'Cripta, Encontro', 'Troll, Criatura', 'Cancelar']);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(within(dialog).getByRole('checkbox', { name: 'Troll, Criatura' }));
    await user.keyboard(' ');
    expect((document.activeElement as HTMLInputElement).checked).toBe(true);
    expect(dialog.textContent).toContain('Vão junto: as perguntas desta conversa e suas respostas, e 1 artefato salvo. Isso não pode ser desfeito.');
    await user.keyboard('{Escape}');
    expect(document.activeElement).toBe(opener);
    expect(posted).toEqual([]);
    // Opened again, nothing is ticked.
    await user.keyboard('{Enter}');
    expect(document.activeElement).toBe(cancel);
    expect(within(dialog).getAllByRole('checkbox').map((box) => (box as HTMLInputElement).checked)).toEqual([false, false]);
    expect(within(dialog).getByRole('button', { name: 'Manter todos' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('speaks English too', async () => {
    const user = userEvent.setup();
    const { action } = recorder();
    render(
      <ConversationDeleteAction
        id={ID}
        questions={3}
        language="en"
        action={action}
        artifacts={[{ id: CRIPTA, name: 'Crypt', typeLabel: 'Encounter' }]}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete this conversation?' });
    const list = within(dialog).getByRole('group', { name: 'Artifacts saved from this conversation' });
    expect(within(list).getByRole('button', { name: 'Keep all' }).getAttribute('aria-pressed')).toBe('true');
    await user.click(within(list).getByRole('button', { name: 'Select all' }));
    expect((within(list).getByRole('checkbox', { name: 'Crypt, Encounter' }) as HTMLInputElement).checked).toBe(true);
    expect(dialog.textContent).toContain('Going with it: 3 questions and their answers, and 1 saved artifact. This cannot be undone.');
  });
});

describe('ConversationDeleteAction rows of overriding artifacts (Story 5.5 part A)', () => {
  const ID = '0190a0b0-0000-7000-8000-000000000020';
  const action = vi.fn(async () => ({ error: null }));

  it('a row whose artifact overrides a record says so, in its text and its name, in both languages', async () => {
    const user = userEvent.setup();
    const artifacts = [
      { id: '0190a0b0-0000-7000-8000-000000000903', name: 'Bola de Fogo (mesa)', typeLabel: 'Magia', overrides: true },
      { id: '0190a0b0-0000-7000-8000-000000000904', name: 'Troll', typeLabel: 'Criatura', overrides: false },
    ];
    const { rerender } = render(<ConversationDeleteAction id={ID} questions={1} language="pt-BR" action={action} artifacts={artifacts} />);
    await user.click(screen.getByRole('button', { name: 'Excluir' }));
    let dialog = screen.getByRole('dialog');
    expect(within(dialog).getAllByRole('listitem').map((row) => row.textContent)).toEqual([
      'Bola de Fogo (mesa)Substitui um registroMagia',
      'TrollCriatura',
    ]);
    expect(within(dialog).getByRole('checkbox', { name: 'Bola de Fogo (mesa), Magia, substitui um registro' })).toBeTruthy();
    expect(within(dialog).getByRole('checkbox', { name: 'Troll, Criatura' })).toBeTruthy();
    await user.keyboard('{Escape}');
    rerender(<ConversationDeleteAction id={ID} questions={1} language="en" action={action} artifacts={artifacts} />);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('checkbox', { name: 'Bola de Fogo (mesa), Magia, overrides a record' })).toBeTruthy();
    expect(dialog.textContent).toContain('Overrides a record');
  });
});

describe('ConversationDeleteAction rows of shared artifacts (Story 5.6 part B)', () => {
  const ID = '0190a0b0-0000-7000-8000-000000000020';
  const action = vi.fn(async () => ({ error: null }));

  it('a shared row adds "Compartilhado", after the override note when it has both, and its name says each note, in both languages', async () => {
    const user = userEvent.setup();
    const artifacts = [
      { id: '0190a0b0-0000-7000-8000-000000000903', name: 'Espada', typeLabel: 'Item', overrides: true, shared: true },
      { id: '0190a0b0-0000-7000-8000-000000000904', name: 'Troll', typeLabel: 'Criatura', overrides: false, shared: true },
      { id: '0190a0b0-0000-7000-8000-000000000905', name: 'Cripta', typeLabel: 'Encontro', shared: false },
    ];
    const { rerender, container } = render(<ConversationDeleteAction id={ID} questions={1} language="pt-BR" action={action} artifacts={artifacts} />);
    await user.click(screen.getByRole('button', { name: 'Excluir' }));
    let dialog = screen.getByRole('dialog');
    expect(within(dialog).getAllByRole('listitem').map((row) => row.textContent)).toEqual([
      'EspadaSubstitui um registroCompartilhadoItem',
      'TrollCompartilhadoCriatura',
      'CriptaEncontro',
    ]);
    expect(within(dialog).getByRole('checkbox', { name: 'Espada, Item, substitui um registro, compartilhado' })).toBeTruthy();
    expect(within(dialog).getByRole('checkbox', { name: 'Troll, Criatura, compartilhado' })).toBeTruthy();
    expect(within(dialog).getByRole('checkbox', { name: 'Cripta, Encontro' })).toBeTruthy();
    // Every row's checkbox is in the Tab order.
    for (const box of within(dialog).getAllByRole('checkbox')) {
      expect(box.hasAttribute('disabled')).toBe(false);
    }
    expectNoStyleAttribute(container);
    await user.keyboard('{Escape}');
    rerender(<ConversationDeleteAction id={ID} questions={1} language="en" action={action} artifacts={artifacts} />);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('checkbox', { name: 'Espada, Item, overrides a record, shared' })).toBeTruthy();
    expect(within(dialog).getByRole('checkbox', { name: 'Troll, Criatura, shared' })).toBeTruthy();
    expect(dialog.textContent).toContain('Shared');
  });
});

describe('MaterialDeleteAction (Story 3.4 part B)', () => {
  const ID = '0190a0b0-0000-7000-8000-000000000003';
  type State = { readonly error: string | null };
  const recorder = (answer: State = { error: null }) => {
    const posted: Record<string, string>[] = [];
    const action = vi.fn(async (_previous: State, form: FormData) => {
      posted.push(Object.fromEntries([...form.entries()].map(([key, value]) => [key, String(value)])));
      return answer;
    });
    return { posted, action };
  };

  it('Excluir is a danger pill that opens the confirmation with the name and the counts; "Excluir arquivo" posts the material', async () => {
    const user = userEvent.setup();
    const { posted, action } = recorder();
    const { container } = render(<MaterialDeleteAction id={ID} name="Livro.pdf" counts={{ versions: 2, pages: 640 }} language="pt-BR" action={action} />);
    const opener = screen.getByRole('button', { name: 'Excluir' });
    expect(opener.dataset.variant).toBe('danger');
    expect(opener.getAttribute('aria-haspopup')).toBe('dialog');
    await user.tab();
    expect(document.activeElement).toBe(opener);
    await user.keyboard('{Enter}');
    const dialog = screen.getByRole('dialog', { name: 'Excluir «Livro.pdf»?' });
    expect(dialog.textContent).toContain(
      'Vão junto: 2 versões e 640 páginas lidas, com as imagens e o texto extraído. As respostas que citaram este arquivo mostram «fonte removida». Isso não pode ser desfeito.',
    );
    await user.keyboard('{Escape}');
    expect(container.querySelector('dialog')?.open).toBe(false);
    expect(document.activeElement).toBe(opener);
    expect(posted).toEqual([]);

    await user.click(opener);
    const confirm = within(screen.getByRole('dialog')).getByRole('button', { name: 'Excluir arquivo' });
    expect(confirm.dataset.variant).toBe('danger');
    await user.click(confirm);
    await vi.waitFor(() => expect(posted).toEqual([{ id: ID }]));
    expect(container.querySelector('dialog')?.open).toBe(false);
    expectNoStyleAttribute(container);
  });

  it('names one of each, the versions alone when no page was read, and what goes in words without counts, in both languages', async () => {
    const user = userEvent.setup();
    const { action } = recorder();
    const { rerender } = render(<MaterialDeleteAction id={ID} name="Livro.pdf" counts={{ versions: 1, pages: 1 }} language="pt-BR" action={action} />);
    await user.click(screen.getByRole('button', { name: 'Excluir' }));
    expect(screen.getByRole('dialog').textContent).toContain('Vão junto: 1 versão e 1 página lida, com as imagens e o texto extraído.');
    await user.keyboard('{Escape}');
    // No page was read: its versions alone, with the uploaded file.
    rerender(<MaterialDeleteAction id={ID} name="Livro.pdf" counts={{ versions: 1, pages: 0 }} language="pt-BR" action={action} />);
    await user.click(screen.getByRole('button', { name: 'Excluir' }));
    expect(screen.getByRole('dialog').textContent).toContain(
      'Vão junto: 1 versão, com o arquivo enviado e tudo o que foi lido dele. As respostas que citaram este arquivo mostram «fonte removida». Isso não pode ser desfeito.',
    );
    expect(screen.getByRole('dialog').textContent).not.toContain('0 páginas');
    await user.keyboard('{Escape}');
    rerender(<MaterialDeleteAction id={ID} name="Livro.pdf" counts={{ versions: 3, pages: 0 }} language="en" action={action} />);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete «Livro.pdf»?' });
    expect(dialog.textContent).toContain('Going with it: 3 versions, with the uploaded file and everything read from it.');
    expect(within(dialog).getByRole('button', { name: 'Delete file' })).toBeTruthy();
    await user.keyboard('{Escape}');
    rerender(<MaterialDeleteAction id={ID} name="Livro.pdf" counts={null} language="pt-BR" action={action} />);
    await user.click(screen.getByRole('button', { name: 'Excluir' }));
    expect(screen.getByRole('dialog').textContent).toContain('Vão junto todas as versões deste arquivo e as páginas lidas delas,');
    await user.keyboard('{Escape}');
    rerender(<MaterialDeleteAction id={ID} name="Livro.pdf" counts={null} language="en" action={action} />);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByRole('dialog').textContent).toContain('Going with it: every version of this file and the pages read from them,');
    await user.keyboard('{Escape}');
    rerender(<MaterialDeleteAction id={ID} name="Livro.pdf" counts={{ versions: 2, pages: 1 }} language="en" action={action} />);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByRole('dialog').textContent).toContain('Going with it: 2 versions and 1 page read, with their pictures and extracted text.');
  });

  it('shows a refusal as an alert under the pill, with focus back on "Excluir"', async () => {
    const user = userEvent.setup();
    const { action } = recorder({ error: 'Não encontrado.' });
    render(<MaterialDeleteAction id={ID} name="Livro.pdf" counts={{ versions: 1, pages: 3 }} language="pt-BR" action={action} />);
    const opener = screen.getByRole('button', { name: 'Excluir' });
    await user.click(opener);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Excluir arquivo' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Não encontrado.');
    expect(document.activeElement).toBe(opener);
  });
});

describe('SupersededVersions (Story 3.4 part B)', () => {
  const ID = '0190a0b0-0000-7000-8000-000000000003';
  const NEWER = { id: '0190a0b0-0000-7000-8000-00000000000b', createdAt: '2026-11-15T14:00:00Z', pages: 320, size: 134217728 };
  const OLDER = { id: '0190a0b0-0000-7000-8000-00000000000a', createdAt: '2026-11-10T14:00:00Z', pages: 1, size: null };
  type State = { readonly error: string | null };
  const recorder = (answer: State = { error: null }) => {
    const posted: Record<string, string>[] = [];
    const action = vi.fn(async (_previous: State, form: FormData) => {
      posted.push(Object.fromEntries([...form.entries()].map(([key, value]) => [key, String(value)])));
      return answer;
    });
    return { posted, action };
  };

  it('is not shown when no version was superseded', () => {
    const { container } = render(<SupersededVersions materialId={ID} versions={[]} language="pt-BR" action={recorder().action} />);
    expect(container.innerHTML).toBe('');
  });

  it('lists each version with its day, pages and size, and "Remover" opens one confirmation that posts that version', async () => {
    const user = userEvent.setup();
    const { posted, action } = recorder();
    const { container } = render(<SupersededVersions materialId={ID} versions={[NEWER, OLDER]} language="pt-BR" action={action} />);
    expect(screen.getByRole('heading', { name: 'Versões anteriores' })).toBeTruthy();
    const rows = screen.getAllByRole('listitem');
    expect(rows.map((row) => row.querySelector('span')?.textContent)).toEqual([
      'Enviada em 15 de nov. de 2026 · 320 páginas · 134,2 MB',
      'Enviada em 10 de nov. de 2026 · 1 página',
    ]);
    const removes = screen.getAllByRole('button', { name: /^Remover/ });
    expect(removes).toHaveLength(2);
    expect(removes.map((button) => button.textContent)).toEqual(['Remover', 'Remover']);
    expect(removes[0]!.dataset.variant).toBe('danger');
    expect(removes[1]!.getAttribute('aria-label')).toBe('Remover a versão enviada em 10 de nov. de 2026');
    // One dialog for every row: dialogs never stack.
    expect(container.querySelectorAll('dialog')).toHaveLength(1);

    await user.click(removes[0]!);
    const dialog = screen.getByRole('dialog', { name: 'Remover esta versão?' });
    expect(dialog.textContent).toContain(
      'Saem as 320 páginas lidas desta versão, com as imagens e o texto extraído. As respostas que a citaram mostram «fonte removida». Isso não pode ser desfeito.',
    );
    await user.keyboard('{Escape}');
    expect(document.activeElement).toBe(removes[0]);
    expect(posted).toEqual([]);

    await user.click(removes[1]!);
    expect(screen.getByRole('dialog').textContent).toContain('Sai a página lida desta versão,');
    const confirm = within(screen.getByRole('dialog')).getByRole('button', { name: 'Remover versão' });
    expect(confirm.dataset.variant).toBe('danger');
    await user.click(confirm);
    await vi.waitFor(() => expect(posted).toEqual([{ id: ID, versionId: OLDER.id }]));
    expect(container.querySelector('dialog')?.open).toBe(false);
    expectNoStyleAttribute(container);
  });

  it('says the version goes in words when its pages are not known, in English too, and shows a refusal as an alert', async () => {
    const user = userEvent.setup();
    const { action } = recorder({ error: 'Only a previous version can be removed. The page has been updated.' });
    render(<SupersededVersions materialId={ID} versions={[{ ...OLDER, pages: null, size: 2048 }]} language="en" action={action} />);
    expect(screen.getByRole('heading', { name: 'Previous versions' })).toBeTruthy();
    expect(screen.getByRole('listitem').querySelector('span')?.textContent).toBe('Uploaded on Nov 10, 2026 · 2 KB');
    const remove = screen.getByRole('button', { name: 'Remove the version uploaded on Nov 10, 2026' });
    await user.click(remove);
    const dialog = screen.getByRole('dialog', { name: 'Remove this version?' });
    expect(dialog.textContent).toContain('This version goes, with everything read from it.');
    await user.click(within(dialog).getByRole('button', { name: 'Remove version' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Only a previous version can be removed. The page has been updated.');
    expect(document.activeElement).toBe(remove);
  });
});

describe('HTML in a material name or section path is text (Story 2.8)', () => {
  const NAME = '<img src="https://example.invalid/x.png" onerror="alert(1)">.pdf';
  const SECTION = '<script>alert(1)</script>';
  const hostile = {
    number: 1,
    kind: 'passage' as const,
    materialName: NAME,
    sectionPath: [SECTION, '<iframe src="https://example.invalid/f"></iframe>'],
    page: 3,
    passageIds: ['0190a0b0-0000-7000-8000-000000000009'],
    removed: false,
  };
  const LINE = `${NAME}, ${SECTION} › <iframe src="https://example.invalid/f"></iframe>`;

  function expectNoElementFromText(container: HTMLElement) {
    for (const tag of ['img', 'script', 'iframe']) {
      expect(container.querySelector(tag), tag).toBeNull();
    }
    expect(container.querySelector('[onerror]')).toBeNull();
    expect(container.querySelector('[src]')).toBeNull();
  }

  it('shows them as text in References, as a button and struck through when removed', () => {
    const { container } = render(
      <References campaignId="c" references={[hostile, { ...hostile, number: 2, removed: true }]} t={translator('pt-BR')} onOpen={() => undefined} />,
    );
    expect(screen.getByRole('button', { name: `${LINE}, p. 3` })).toBeTruthy();
    expect(container.querySelector('s')!.textContent).toBe(`${LINE}, p. 3`);
    expectNoElementFromText(container);
  });

  it('shows them as text in the SourceView heading', async () => {
    const { container } = render(<SourceView turnId="0190a0b0-0000-7000-8000-000000000021" reference={hostile} language="en" onClose={() => undefined} load={async () => null} />);
    const heading = screen.getByRole('heading', { level: 2 });
    expect(heading.textContent).toBe(LINE);
    expect(heading.children).toHaveLength(0);
    expect(screen.getByRole('dialog', { name: LINE })).toBeTruthy();
    expect(await screen.findByRole('alert')).toBeTruthy();
    expectNoElementFromText(container);
  });
});

describe('ItemList (Story 3.1)', () => {
  const row = (id: string, label: string, href: string | null = null) => ({ id, label, detail: null, href, state: null });

  it('shows the rows, each opening its page when it has one; without paging it is a plain list', async () => {
    const { ItemList } = await import('@/components/ItemList');
    const { container } = render(
      <ItemList label="Seus sistemas" rows={[{ ...row('a', 'D&D', '/systems/a'), detail: '5.2.1' }, row('b', 'Segundo', '/systems/b'), row('c', 'Terceiro')]} />,
    );
    const list = screen.getByRole('list', { name: 'Seus sistemas' });
    expect(within(list).getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual(['/systems/a', '/systems/b']);
    expect(within(list).getAllByRole('link')[0]!.textContent).toBe('D&D5.2.1');
    // A row without a page opens nothing.
    expect(screen.getByText('Terceiro').closest('a')).toBeNull();
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    // No pager, no display menu, and nothing that adds rows: the rows are what the server gave.
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expectNoStyleAttribute(container);
  });

  it('a paged list names the rows shown and links to the other pages, with no style attribute', async () => {
    const { ItemList } = await import('@/components/ItemList');
    const { DEFAULT_VIEW } = await import('@/view-cookie');
    const { container } = render(
      <ItemList
        label="Lista"
        rows={[row('a', 'D&D', '/systems/a')]}
        pages={{ paging: { page: 2, pages: 3, total: 21, from: 11, to: 20 }, path: '/systems' }}
        viewKey="systems"
        view={DEFAULT_VIEW}
        language="en"
      />,
    );
    const pager = screen.getByRole('navigation', { name: 'Pagination' });
    expect(within(pager).getAllByRole('link').map((link) => `${link.textContent}:${link.getAttribute('href')}`)).toEqual([
      'Previous:/systems',
      '1:/systems',
      '2:/systems?page=2',
      '3:/systems?page=3',
      'Next:/systems?page=3',
    ]);
    expect(screen.getAllByText('11–20 of 21')).toHaveLength(2);
    expectNoStyleAttribute(container);
  });
});

type SystemFormState = import('@/app/(signed-in)/systems/form-state').SystemFormState;

describe('SystemForm (Story 3.1)', () => {
  const labels = { name: 'Nome', edition: 'Edição (opcional)', description: 'Descrição (opcional)', submit: 'Salvar', cancel: 'Cancelar' };
  const start = { values: { name: 'D&D', edition: '5.2.1', description: '' }, version: 3, error: null, field: null, stale: false };

  it('labels its fields, marks the name required, has one solid pill and "Cancelar", and posts the id and version', async () => {
    const { SystemForm } = await import('@/components/SystemForm');
    const user = userEvent.setup();
    const action = vi.fn<(previous: SystemFormState, form: FormData) => Promise<SystemFormState>>(async () => start);
    const { container } = render(<SystemForm labels={labels} initial={start} id="s1" cancelHref="/systems/s1" action={action} />);
    expect(screen.getByLabelText('Nome').getAttribute('aria-required')).toBe('true');
    expect(screen.getByLabelText('Edição (opcional)').getAttribute('aria-required')).toBeNull();
    expect(screen.getByLabelText('Descrição (opcional)').tagName).toBe('TEXTAREA');
    // No maxLength: the backend counts code points after trimming, and its field problem decides.
    expect(container.querySelectorAll('[maxlength]')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Salvar' }).dataset.variant).toBe('solid');
    expect(screen.getByRole('link', { name: 'Cancelar' }).getAttribute('href')).toBe('/systems/s1');
    expect(container.querySelectorAll('[data-variant="solid"]')).toHaveLength(1);
    expect(screen.queryByRole('alert')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    const sent = action.mock.calls[0]![1];
    expect(sent.get('id')).toBe('s1');
    expect(sent.get('version')).toBe('3');
    expect(sent.get('name')).toBe('D&D');
    expectNoStyleAttribute(container);
  });

  it('shows a refusal under its field and keeps what was typed; a stale edit says so and shows the current values', async () => {
    const { SystemForm } = await import('@/components/SystemForm');
    const user = userEvent.setup();
    const action = vi
      .fn()
      .mockResolvedValueOnce({ ...start, values: { ...start.values, name: 'd&d', edition: '2024' }, error: 'Você já tem um sistema com este nome e esta edição.', field: 'name' })
      .mockResolvedValueOnce({ values: { name: 'D&D (casa)', edition: '', description: 'Novo.' }, version: 5, error: 'Este sistema foi alterado em outro lugar.', field: null, stale: true })
      .mockResolvedValueOnce({ values: { name: 'D&D (casa)', edition: '', description: 'Novo.' }, version: 5, error: null, field: null, stale: false });
    render(<SystemForm labels={labels} initial={start} id="s1" cancelHref="/systems/s1" action={action} />);
    const name = screen.getByLabelText('Nome') as HTMLInputElement;
    await user.clear(name);
    await user.type(name, 'd&d');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Você já tem um sistema com este nome e esta edição.');
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(name.getAttribute('aria-describedby')).toBe(alert.id);
    expect((screen.getByLabelText('Nome') as HTMLInputElement).value).toBe('d&d');
    expect(screen.getByLabelText('Edição (opcional)').getAttribute('aria-invalid')).toBe('false');

    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    const stale = await screen.findByText('Este sistema foi alterado em outro lugar.');
    expect(stale.getAttribute('role')).toBe('alert');
    expect((screen.getByLabelText('Nome') as HTMLInputElement).value).toBe('D&D (casa)');
    expect((screen.getByLabelText('Edição (opcional)') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Descrição (opcional)') as HTMLTextAreaElement).value).toBe('Novo.');
    expect(screen.getByLabelText('Nome').getAttribute('aria-invalid')).toBe('false');
    // The next save names the current version.
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect((action.mock.calls[2]?.[1] as FormData).get('version')).toBe('5');
  });
});

type ShieldFormState = import('@/app/(signed-in)/campaigns/[id]/shields/form-state').ShieldFormState;

describe('ShieldForm (Story 6.1)', () => {
  const labels = { name: 'Nome', submit: 'Salvar', cancel: 'Cancelar', placeholder: 'Escudo do Mestre' };
  const start: ShieldFormState = { values: { name: '' }, version: 3, error: null, field: null, stale: false };

  it('labels its field, starts an unnamed Shield empty with its default name as the placeholder, and posts campaign, id, version and name', async () => {
    const { ShieldForm } = await import('@/components/ShieldForm');
    const user = userEvent.setup();
    const action = vi.fn<(previous: ShieldFormState, form: FormData) => Promise<ShieldFormState>>(async () => start);
    const { container } = render(
      <ShieldForm labels={labels} initial={start} campaignId="c1" id="s1" cancelHref="/campaigns/c1/shields/s1" action={action} />,
    );
    const name = screen.getByLabelText('Nome') as HTMLInputElement;
    expect(name.value).toBe('');
    expect(name.placeholder).toBe('Escudo do Mestre');
    expect(name.getAttribute('aria-required')).toBe('true');
    expect(container.querySelectorAll('[maxlength]')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Salvar' }).dataset.variant).toBe('solid');
    expect(screen.getByRole('link', { name: 'Cancelar' }).getAttribute('href')).toBe('/campaigns/c1/shields/s1');
    expect(screen.queryByRole('alert')).toBeNull();

    await user.type(name, 'Exploração');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    const sent = action.mock.calls[0]![1];
    expect(sent.get('campaign')).toBe('c1');
    expect(sent.get('id')).toBe('s1');
    expect(sent.get('version')).toBe('3');
    expect(sent.get('name')).toBe('Exploração');
    expectNoStyleAttribute(container);
  });

  it('shows a refusal under the name and keeps what was typed; a stale rename shows the current name and posts its version next', async () => {
    const { ShieldForm } = await import('@/components/ShieldForm');
    const user = userEvent.setup();
    const action = vi
      .fn()
      .mockResolvedValueOnce({ values: { name: 'combate' }, version: 3, error: 'Esta campanha já tem um escudo com este nome.', field: 'name', stale: false })
      .mockResolvedValueOnce({ values: { name: 'Viagem' }, version: 5, error: 'Este escudo foi alterado em outro lugar.', field: null, stale: true })
      .mockResolvedValueOnce({ values: { name: 'Viagem' }, version: 5, error: null, field: null, stale: false });
    render(<ShieldForm labels={labels} initial={start} campaignId="c1" id="s1" cancelHref="/campaigns/c1/shields/s1" action={action} />);
    const name = screen.getByLabelText('Nome') as HTMLInputElement;
    await user.type(name, 'combate');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Esta campanha já tem um escudo com este nome.');
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(name.getAttribute('aria-describedby')).toBe(alert.id);
    expect((screen.getByLabelText('Nome') as HTMLInputElement).value).toBe('combate');

    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    const stale = await screen.findByText('Este escudo foi alterado em outro lugar.');
    expect(stale.getAttribute('role')).toBe('alert');
    expect((screen.getByLabelText('Nome') as HTMLInputElement).value).toBe('Viagem');
    expect(screen.getByLabelText('Nome').getAttribute('aria-invalid')).toBe('false');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect((action.mock.calls[2]?.[1] as FormData).get('version')).toBe('5');
  });
});

describe('TierLabel (Story 3.7)', () => {
  afterEach(cleanup);

  it('is an outlined pill with the tier\'s word, never focusable and with no role of its own', () => {
    const pt = translator('pt-BR');
    const en = translator('en');
    const { container } = render(
      <p>
        <TierLabel tier="campaign" t={pt} />
        <TierLabel tier="system" t={pt} />
        <TierLabel tier="other" t={pt} />
        <TierLabel tier="campaign" t={en} className="extra" />
      </p>,
    );
    const pills = Array.from(container.querySelectorAll<HTMLElement>('span[data-tier]'));
    expect(pills.map((pill) => pill.textContent)).toEqual(['Campanha', 'Sistema', 'Outros', 'Campaign']);
    expect(pills.map((pill) => pill.dataset.tier)).toEqual(['campaign', 'system', 'other', 'campaign']);
    for (const pill of pills) {
      expect(pill.className).toMatch(/pill/);
      expect(pill.getAttribute('role')).toBeNull();
      expect(pill.getAttribute('tabindex')).toBeNull();
      expect(pill.getAttribute('aria-hidden')).toBeNull();
    }
    expect(pills[3]!.className).toMatch(/extra/);
    // Each word is followed by a visually hidden ": ", so a reader never runs it into what follows.
    expect(pills.map((pill) => pill.nextElementSibling?.textContent)).toEqual([': ', ': ', ': ', ': ']);
    expect(pills.every((pill) => /separator/u.test(pill.nextElementSibling?.className ?? ''))).toBe(true);
    expect(container.textContent).toBe('Campanha: Sistema: Outros: Campaign: ');
    // The words are the scope's own ("shell.scope.*"), so a tier reads the same everywhere.
    expect(tierWord('other', en)).toBe(en('shell.scope.other'));
  });

  it('is drawn on a reference line before its button, and not at all for a reference without a tier', () => {
    const t = translator('pt-BR');
    const base = { kind: 'passage' as const, materialName: 'Livro.pdf', sectionPath: [], page: 3, passageIds: ['p'], removed: false };
    render(<References campaignId="c" references={[{ ...base, number: 1, tier: 'system' }, { ...base, number: 2 }]} t={t} onOpen={() => undefined} />);
    const items = screen.getAllByRole('listitem');
    expect(items[0]!.firstElementChild?.textContent).toBe('Sistema');
    expect(items[0]!.querySelector('[data-tier] + span + button')).not.toBeNull();
    expect(items[1]!.querySelector('[data-tier]')).toBeNull();
  });
});
