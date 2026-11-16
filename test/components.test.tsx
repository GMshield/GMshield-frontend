import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

type SetCall = { name: string; value: string; options: Record<string, unknown> };
const setCalls: SetCall[] = [];
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
    await user.click(confirm);
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(opener);
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
  it('has two labelled radio groups with the current choice, and an "Aplicar" pill', () => {
    const { container } = render(<PreferencesForm theme="dark" language="pt-BR" />);
    const theme = screen.getByRole('group', { name: 'Tema' });
    const language = screen.getByRole('group', { name: 'Idioma' });
    expect(within(theme).getAllByRole('radio').map((radio) => (radio as HTMLInputElement).value)).toEqual(['illustrated', 'dark', 'light']);
    expect(within(theme).getByRole('radio', { name: 'Escuro' })).toHaveProperty('checked', true);
    expect(within(language).getByRole('radio', { name: 'Português (Brasil)' })).toHaveProperty('checked', true);
    expect(within(language).getByRole('radio', { name: 'English' })).toHaveProperty('checked', false);
    expect(screen.getByRole('button', { name: 'Aplicar' })).toHaveProperty('type', 'submit');
    expectNoStyleAttribute(container);
  });

  it('labels everything in English', () => {
    render(<PreferencesForm theme="illustrated" language="en" />);
    expect(screen.getByRole('form', { name: 'Preferences' })).toBeTruthy();
    expect(within(screen.getByRole('group', { name: 'Theme' })).getByRole('radio', { name: 'Illustrated' })).toHaveProperty('checked', true);
    expect(screen.getByRole('group', { name: 'Language' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Apply' })).toBeTruthy();
  });

  it('submits the choice to the Server Action, which sets both cookies', async () => {
    const user = userEvent.setup();
    render(<PreferencesForm theme="illustrated" language="pt-BR" />);
    await user.click(screen.getByRole('radio', { name: 'Claro' }));
    await user.click(screen.getByRole('radio', { name: 'English' }));
    await user.click(screen.getByRole('button', { name: 'Aplicar' }));
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
