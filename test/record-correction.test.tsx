import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const routerRefresh = vi.fn();
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ refresh: () => routerRefresh(), push: () => undefined, replace: () => undefined, prefetch: () => undefined }),
}));

const { RecordCorrection, NO_CORRECTION } = await import('@/components/RecordCorrection');
type RecordCorrectionState = import('@/components/RecordCorrection').RecordCorrectionState;
type RecordDeleteState = import('@/components/RecordCorrection').RecordDeleteState;
type RecordDeletion = import('@/components/RecordCorrection').RecordDeletion;
const { correctionTexts, deletionTexts, typeOptions } = await import('@/app/(signed-in)/records/correction');
const { translator } = await import('@/messages');

const SYSTEM = '0190a0b0-0000-7000-8000-000000000001';
const RECORD = '0190a0b0-0000-7000-8000-000000000700';
const TYPES = [
  { key: 'rule', label: 'Regra' },
  { key: 'spell', label: 'Magia' },
  { key: 'talento', label: 'Talento' },
];
const VALUES = {
  name: 'Fire Boll',
  recordType: 'spell',
  fields: [
    { name: 'Alcance', value: '45 m' },
    { name: 'Nível', value: '1' },
  ],
};

type Action = (previous: RecordCorrectionState, form: FormData) => Promise<RecordCorrectionState>;

beforeEach(() => routerRefresh.mockClear());
afterEach(() => cleanup());

function correction(action: Action) {
  return render(
    <RecordCorrection
      ground={{ kind: 'system', systemId: SYSTEM }}
      recordId={RECORD}
      version={3}
      values={VALUES}
      types={TYPES}
      texts={correctionTexts(translator('pt-BR'))}
      action={action}
    >
      <dl aria-label="Campos">
        <dt>Alcance</dt>
        <dd>45 m</dd>
      </dl>
    </RecordCorrection>,
  );
}

/** What a post carried, as the Server Action reads it. */
function posted(form: FormData) {
  return {
    ground: form.get('ground'),
    owner: form.get('owner'),
    recordId: form.get('recordId'),
    version: form.get('version'),
    name: form.get('name'),
    recordType: form.get('recordType'),
    fieldName: form.getAll('fieldName'),
    fieldValue: form.getAll('fieldValue'),
  };
}

describe("a record's correction (Story 4.5)", () => {
  it('shows the fields and "Corrigir"; the form opens in their place with the record\'s values, the focus on the name', async () => {
    const user = userEvent.setup();
    correction(vi.fn());
    expect(screen.getByLabelText('Campos').tagName).toBe('DL');
    expect(screen.queryByRole('form')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Corrigir' }));

    const form = screen.getByRole('form', { name: 'Corrigir «Fire Boll»' });
    expect(screen.queryByText('45 m', { selector: 'dd' })).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Nome' })).toHaveProperty('value', 'Fire Boll');
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Nome' }));
    const type = screen.getByRole('combobox', { name: 'Tipo de registro' }) as HTMLSelectElement;
    expect(type.value).toBe('spell');
    expect([...type.options].map((option) => option.textContent)).toEqual(['Regra', 'Magia', 'Talento']);
    expect(screen.getByRole('textbox', { name: 'Nome do campo 1' })).toHaveProperty('value', 'Alcance');
    expect(screen.getByRole('textbox', { name: 'Valor do campo 2' })).toHaveProperty('value', '1');
    expect(within(form).getByRole('button', { name: 'Salvar' })).toBeTruthy();
    expect(within(form).getByRole('button', { name: 'Adicionar campo' })).toBeTruthy();
    expect(within(form).getAllByRole('button', { name: /^Remover campo \d$/ })).toHaveLength(2);
  });

  it('saves the edited name, type and fields on the version read, and closes once saved with the focus on "Corrigir"', async () => {
    const user = userEvent.setup();
    const action = vi.fn<Action>(async (previous) => ({ ...NO_CORRECTION, serial: previous.serial + 1, saved: true, currentVersion: 4 }));
    correction(action);
    await user.click(screen.getByRole('button', { name: 'Corrigir' }));
    const name = screen.getByRole('textbox', { name: 'Nome' });
    await user.clear(name);
    await user.type(name, 'Fire Bolt');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Tipo de registro' }), 'talento');
    // The second field goes; a new one comes, taking the focus.
    await user.click(screen.getByRole('button', { name: 'Remover campo 2' }));
    expect(screen.queryByRole('textbox', { name: 'Valor do campo 2' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Adicionar campo' }));
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Nome do campo 2' }));
    await user.keyboard('Dano');
    await user.type(screen.getByRole('textbox', { name: 'Valor do campo 2' }), '1d10');

    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(action).toHaveBeenCalledTimes(1);
    expect(posted(action.mock.calls[0]![1])).toEqual({
      ground: 'system',
      owner: SYSTEM,
      recordId: RECORD,
      version: '3',
      name: 'Fire Bolt',
      recordType: 'talento',
      fieldName: ['Alcance', 'Dano'],
      fieldValue: ['45 m', '1d10'],
    });
    // The action answers asynchronously: the form closes, and "Corrigir" gets the focus, once it has.
    await waitFor(() => {
      expect(screen.queryByRole('form')).toBeNull();
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Corrigir' }));
    });
  });

  it('opened again right after a save, before the page brings the new version, saves on the saved version', async () => {
    const user = userEvent.setup();
    const action = vi.fn<Action>(async (previous) => ({ ...NO_CORRECTION, serial: previous.serial + 1, saved: true, currentVersion: 4 }));
    correction(action);
    await user.click(screen.getByRole('button', { name: 'Corrigir' }));
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    // The page still holds version 3 (its refresh has not arrived).
    await user.click(screen.getByRole('button', { name: 'Corrigir' }));
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(action.mock.calls.map(([, form]) => form.get('version'))).toEqual(['3', '4']);
  });

  it('shows a refusal under the part it is about, with what was typed kept', async () => {
    const user = userEvent.setup();
    const answers: Partial<RecordCorrectionState>[] = [
      { error: 'O valor do campo precisa ter de 1 a 8000 caracteres.', field: 'fieldValue:1' },
      { error: 'O nome precisa ter de 1 a 200 caracteres.', field: 'name' },
      { error: 'O pedido não pôde ser atendido.', field: null },
    ];
    const action = vi.fn<Action>(async (previous) => ({ ...NO_CORRECTION, ...answers[previous.serial], serial: previous.serial + 1 }));
    correction(action);
    await user.click(screen.getByRole('button', { name: 'Corrigir' }));
    await user.clear(screen.getByRole('textbox', { name: 'Valor do campo 2' }));

    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    const value = screen.getByRole('textbox', { name: 'Valor do campo 2' });
    expect(value.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(value.getAttribute('aria-describedby')!)?.textContent).toBe(
      'O valor do campo precisa ter de 1 a 8000 caracteres.',
    );
    expect(screen.getByRole('textbox', { name: 'Nome' }).getAttribute('aria-invalid')).toBe('false');
    expect(screen.getByRole('textbox', { name: 'Nome' })).toHaveProperty('value', 'Fire Boll');

    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(screen.getByRole('textbox', { name: 'Nome' }).getAttribute('aria-invalid')).toBe('true');
    expect(value.getAttribute('aria-invalid')).toBe('false');

    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(screen.getByRole('alert').textContent).toBe('O pedido não pôde ser atendido.');
    expect(screen.getByRole('form')).toBeTruthy();
  });

  it('a stale save offers the current version, which reads the page again, or the GM\'s edits saved as a new version', async () => {
    const user = userEvent.setup();
    const action = vi.fn<Action>(async (previous, form) =>
      form.get('version') === '3'
        ? { ...NO_CORRECTION, serial: previous.serial + 1, stale: true, currentVersion: 4 }
        : { ...NO_CORRECTION, serial: previous.serial + 1, saved: true, currentVersion: 5 },
    );
    correction(action);
    await user.click(screen.getByRole('button', { name: 'Corrigir' }));
    await user.type(screen.getByRole('textbox', { name: 'Nome' }), '!');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Este item mudou em outra aba.');
    // Both choices are buttons, reachable from the keyboard.
    const keep = within(alert).getByRole('button', { name: 'Manter a minha como nova versão' });
    keep.focus();
    await user.keyboard('{Enter}');

    expect(action).toHaveBeenCalledTimes(2);
    expect(posted(action.mock.calls[1]![1])).toMatchObject({ version: '4', name: 'Fire Boll!', fieldName: ['Alcance', 'Nível'] });
    expect(screen.queryByRole('form')).toBeNull();
  });

  it('"Ver a versão atual" closes the form and reads the page again; "Cancelar" closes it and gives the focus back', async () => {
    const user = userEvent.setup();
    const action = vi.fn<Action>(async (previous) => ({ ...NO_CORRECTION, serial: previous.serial + 1, stale: true, currentVersion: 4 }));
    correction(action);
    await user.click(screen.getByRole('button', { name: 'Corrigir' }));
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await user.click(screen.getByRole('button', { name: 'Ver a versão atual' }));
    expect(routerRefresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('form')).toBeNull();

    // Opened again, nothing of the earlier answer shows; "Cancelar" from the keyboard closes it.
    await user.click(screen.getByRole('button', { name: 'Corrigir' }));
    expect(screen.queryByRole('alert')).toBeNull();
    screen.getByRole('button', { name: 'Cancelar' }).focus();
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('form')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Corrigir' }));
    await act(async () => undefined);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('a record without fields says so in the form, and removing the last field leaves the focus on "Adicionar campo"', async () => {
    const user = userEvent.setup();
    render(
      <RecordCorrection
        ground={{ kind: 'campaign', campaignId: '0190a0b0-0000-7000-8000-000000000002' }}
        recordId={RECORD}
        version={0}
        values={{ name: 'Luz', recordType: 'note', fields: [{ name: 'Nota', value: 'x' }] }}
        types={TYPES}
        texts={correctionTexts(translator('en'))}
        action={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Correct' }));
    // A key the list lacks is still offered, first.
    const type = screen.getByRole('combobox', { name: 'Record type' }) as HTMLSelectElement;
    expect(type.value).toBe('note');
    await user.click(screen.getByRole('button', { name: 'Remove field 1' }));
    expect(screen.getByText('This record has no fields.')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add field' }));
  });

  it("offers the system's record types by this interface's names, the record's own type first when the list lacks it", () => {
    const t = translator('pt-BR');
    const origin = { kind: 'core' as const, proposalId: null, materialId: null, materialName: null };
    const types = [
      { id: '0190a0b0-0000-7000-8000-000000000600', name: 'rule', core: 'rule' as const, key: 'rule', origin, records: 0, version: 0 },
      { id: '0190a0b0-0000-7000-8000-000000000601', name: 'spell', core: 'spell' as const, key: 'spell', origin, records: 3, version: 0 },
      { id: '0190a0b0-0000-7000-8000-0000000006e2', name: 'Talento', core: null, key: 'talento', origin, records: 1, version: 0 },
    ];
    expect(typeOptions(types, { key: 'spell', name: 'spell', core: 'spell' }, t)).toEqual([
      { key: 'rule', label: 'Regra' },
      { key: 'spell', label: 'Magia' },
      { key: 'talento', label: 'Talento' },
    ]);
    // A type approved in another system, or a list that could not be read: the record's own type comes first.
    expect(typeOptions(types, { key: 'feat', name: 'Feat', core: null }, t)).toEqual([
      { key: 'feat', label: 'Feat' },
      { key: 'rule', label: 'Regra' },
      { key: 'spell', label: 'Magia' },
      { key: 'talento', label: 'Talento' },
    ]);
    expect(typeOptions([], { key: 'item', name: 'item', core: 'item' }, t)).toEqual([{ key: 'item', label: 'Item' }]);
  });
});

describe("a record's delete (Story 4.5 part B)", () => {
  // jsdom has no modal dialogs: the smallest stand-in for showModal() and close().
  beforeAll(() => {
    if (typeof HTMLDialogElement.prototype.showModal !== 'function') {
      HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
        this.setAttribute('open', '');
      };
      HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
        this.removeAttribute('open');
      };
    }
  });

  type DeleteAction = (previous: RecordDeleteState, form: FormData) => Promise<RecordDeleteState>;

  function deletable(action: DeleteAction, after: RecordDeletion['after'], language: 'pt-BR' | 'en' = 'pt-BR', campaign = false) {
    const t = translator(language);
    return render(
      <RecordCorrection
        ground={campaign ? { kind: 'campaign', campaignId: '0190a0b0-0000-7000-8000-000000000002' } : { kind: 'system', systemId: SYSTEM }}
        recordId={RECORD}
        version={3}
        values={VALUES}
        types={TYPES}
        texts={correctionTexts(t)}
        action={vi.fn()}
        deletion={{ texts: deletionTexts(t), language, action, after }}
      />,
    );
  }

  it('"Excluir" is a danger pill beside "Corrigir" that asks first; "Cancelar" or Esc closes and sends nothing', async () => {
    const user = userEvent.setup();
    const action = vi.fn<DeleteAction>(async () => ({ error: null }));
    const { container } = deletable(action, { recordTypeId: '0190a0b0-0000-7000-8000-000000000601' });
    const opener = screen.getByRole('button', { name: 'Excluir' });
    expect(opener.dataset.variant).toBe('danger');
    expect(opener.getAttribute('aria-haspopup')).toBe('dialog');
    expect(opener.previousElementSibling).toBe(screen.getByRole('button', { name: 'Corrigir' }));

    // From the keyboard: Tab past "Corrigir" to "Excluir", Enter opens the dialog.
    await user.tab();
    await user.tab();
    expect(document.activeElement).toBe(opener);
    await user.keyboard('{Enter}');
    const dialog = screen.getByRole('dialog', { name: 'Excluir «Fire Boll»?' });
    expect(dialog.textContent).toContain('Isso não pode ser desfeito.');
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Cancelar' }));
    await user.keyboard('{Escape}');
    expect(container.querySelector('dialog')?.open).toBe(false);
    expect(document.activeElement).toBe(opener);

    await user.click(opener);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar' }));
    expect(container.querySelector('dialog')?.open).toBe(false);
    expect(document.activeElement).toBe(opener);
    expect(action).not.toHaveBeenCalled();
  });

  it("confirmed, it posts the record with the type's list to go to on a system's page, or the search on a campaign's", async () => {
    const user = userEvent.setup();
    const posted: Record<string, string>[] = [];
    const action = vi.fn<DeleteAction>(async (_previous, form) => {
      posted.push(Object.fromEntries([...form.entries()].map(([key, value]) => [key, String(value)])));
      return { error: null };
    });
    deletable(action, { recordTypeId: '0190a0b0-0000-7000-8000-000000000601' });
    await user.click(screen.getByRole('button', { name: 'Excluir' }));
    const confirm = within(screen.getByRole('dialog')).getByRole('button', { name: 'Excluir registro' });
    expect(confirm.dataset.variant).toBe('danger');
    await user.click(confirm);
    await waitFor(() =>
      expect(posted).toEqual([{ ground: 'system', owner: SYSTEM, recordId: RECORD, recordTypeId: '0190a0b0-0000-7000-8000-000000000601' }]),
    );
    cleanup();

    deletable(action, { back: '/search?q=fogo' }, 'en', true);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByRole('dialog', { name: 'Delete «Fire Boll»?' }).textContent).toContain('This cannot be undone.');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete record' }));
    await waitFor(() =>
      expect(posted[1]).toEqual({ ground: 'campaign', owner: '0190a0b0-0000-7000-8000-000000000002', recordId: RECORD, back: '/search?q=fogo' }),
    );
  });

  it('a refusal shows as an alert under the pills, with the focus still on "Excluir"', async () => {
    const user = userEvent.setup();
    const action = vi.fn<DeleteAction>(async () => ({ error: 'Não encontrado.' }));
    deletable(action, { recordTypeId: '0190a0b0-0000-7000-8000-000000000601' });
    const opener = screen.getByRole('button', { name: 'Excluir' });
    await user.click(opener);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Excluir registro' }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Não encontrado.'));
    expect(document.activeElement).toBe(opener);
    expect(opener.getAttribute('aria-disabled')).toBe('false');
  });

  it('a page without a delete shows "Corrigir" alone', () => {
    correction(vi.fn());
    expect(screen.queryByRole('button', { name: 'Excluir' })).toBeNull();
    expect(screen.queryByRole('dialog', { hidden: true })).toBeNull();
  });
});
