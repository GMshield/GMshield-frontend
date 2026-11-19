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
const { PageView, pictureUrl } = await import('@/components/PageView');
const { MaterialActions } = await import('@/components/MaterialActions');

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
      'Descartar:default',
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
      'Discard:default',
    ]);
    rerender(<MaterialActions id={ID} name="Livro.pdf" actions={[]} pages={444} language="en" action={action} />);
    expect(container.querySelector('form')).toBeNull();
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
