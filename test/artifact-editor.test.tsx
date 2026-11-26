import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const routerRefresh = vi.fn();
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ refresh: () => routerRefresh(), push: () => undefined, replace: () => undefined, prefetch: () => undefined }),
}));

/** Story 5.2: an artifact's edit in place and its "Versões", modelled on a record's correction (record-correction.test.tsx). */
const { ArtifactEditor } = await import('@/components/ArtifactEditor');
const { ArtifactVersions } = await import('@/components/ArtifactVersions');
const { NO_ARTIFACT_EDIT, NO_ARTIFACT_RESTORE } = await import('@/app/(signed-in)/campaigns/[id]/artifacts/form-state');
const { artifactEditorTexts, artifactVersionsTexts } = await import('@/app/(signed-in)/campaigns/[id]/artifacts/texts');
const { translator } = await import('@/messages');
type ArtifactEditState = import('@/app/(signed-in)/campaigns/[id]/artifacts/form-state').ArtifactEditState;
type ArtifactRestoreState = import('@/app/(signed-in)/campaigns/[id]/artifacts/form-state').ArtifactRestoreState;

const CAMPAIGN = '0190a0b0-0000-7000-8000-000000000002';
const ARTIFACT = '0190a0b0-0000-7000-8000-000000000900';
const TYPES = [
  { key: 'item', label: 'Item' },
  { key: 'note', label: 'Nota' },
  { key: 'arma', label: 'Arma' },
];
const VALUES = {
  recordType: 'item',
  name: 'Espada de Kael',
  fields: [
    { name: 'Dano', value: '1d8 cortante' },
    { name: 'Peso', value: '1,5 kg' },
  ],
  content: 'Forjada no norte.',
};

type EditAction = (previous: ArtifactEditState, form: FormData) => Promise<ArtifactEditState>;
type RestoreAction = (previous: ArtifactRestoreState, form: FormData) => Promise<ArtifactRestoreState>;

beforeEach(() => routerRefresh.mockClear());
afterEach(() => cleanup());

function editor(action: EditAction, language: 'pt-BR' | 'en' = 'pt-BR') {
  return render(
    <ArtifactEditor
      campaignId={CAMPAIGN}
      artifactId={ARTIFACT}
      version={2}
      values={VALUES}
      types={TYPES}
      texts={artifactEditorTexts(translator(language))}
      action={action}
    >
      <dl aria-label="Campos">
        <dt>Dano</dt>
        <dd>1d8 cortante</dd>
      </dl>
    </ArtifactEditor>,
  );
}

/** What a post carried, as the Server Action reads it. */
function posted(form: FormData) {
  return {
    campaignId: form.get('campaignId'),
    artifactId: form.get('artifactId'),
    version: form.get('version'),
    name: form.get('name'),
    recordType: form.get('recordType'),
    fieldName: form.getAll('fieldName'),
    fieldValue: form.getAll('fieldValue'),
    content: form.get('content'),
  };
}

describe("an artifact's edit (Story 5.2)", () => {
  it('shows the fields and "Editar"; the form opens in their place with the newest version\'s values, the focus on the name', async () => {
    const user = userEvent.setup();
    editor(vi.fn());
    expect(screen.getByLabelText('Campos').tagName).toBe('DL');
    expect(screen.queryByRole('form')).toBeNull();
    // Nothing here deletes.
    expect(screen.queryByRole('button', { name: /Excluir/ })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Editar' }));

    const form = screen.getByRole('form', { name: 'Editar «Espada de Kael»' });
    expect(screen.queryByLabelText('Campos')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Nome' }));
    expect((screen.getByRole('combobox', { name: 'Tipo de registro' }) as HTMLSelectElement).value).toBe('item');
    expect(screen.getByRole('textbox', { name: 'Valor do campo 2' })).toHaveProperty('value', '1,5 kg');
    expect(screen.getByRole('textbox', { name: 'Conteúdo' })).toHaveProperty('value', 'Forjada no norte.');
    expect(within(form).getByRole('button', { name: 'Salvar' }).getAttribute('data-variant')).toBe('solid');
    expect(within(form).getByRole('button', { name: 'Cancelar' })).toBeTruthy();
  });

  it('saves the name, type, fields and content on the version read, closes, and says from when it applies', async () => {
    const user = userEvent.setup();
    const action = vi.fn<EditAction>(async (previous) => ({ ...NO_ARTIFACT_EDIT, serial: previous.serial + 1, saved: true, currentVersion: 3 }));
    editor(action);
    await user.click(screen.getByRole('button', { name: 'Editar' }));
    const name = screen.getByRole('textbox', { name: 'Nome' });
    await user.clear(name);
    await user.type(name, 'Espada Rubra');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Tipo de registro' }), 'arma');
    await user.click(screen.getByRole('button', { name: 'Remover campo 2' }));
    const content = screen.getByRole('textbox', { name: 'Conteúdo' });
    await user.clear(content);
    await user.type(content, 'Reforjada no vulcão.');

    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(posted(action.mock.calls[0]![1])).toEqual({
      campaignId: CAMPAIGN,
      artifactId: ARTIFACT,
      version: '2',
      name: 'Espada Rubra',
      recordType: 'arma',
      fieldName: ['Dano'],
      fieldValue: ['1d8 cortante'],
      content: 'Reforjada no vulcão.',
    });
    await waitFor(() => {
      expect(screen.queryByRole('form')).toBeNull();
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Editar' }));
    });
    expect(screen.getByRole('status').textContent).toBe('Vale a partir da próxima pergunta.');

    // Opened again before the page brings version 3, the edit goes on the saved version.
    await user.click(screen.getByRole('button', { name: 'Editar' }));
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(action.mock.calls.map(([, form]) => form.get('version'))).toEqual(['2', '3']);
  });

  it('shows a refusal under the part it is about, the content\'s with the focus on it, with what was typed kept', async () => {
    const user = userEvent.setup();
    const answers: Partial<ArtifactEditState>[] = [
      { error: 'O conteúdo pode ter até 20000 caracteres.', field: 'content' },
      { error: 'O nome precisa ter de 1 a 200 caracteres.', field: 'name' },
      { error: 'Não encontrado.', field: null },
    ];
    const action = vi.fn<EditAction>(async (previous) => ({ ...NO_ARTIFACT_EDIT, ...answers[previous.serial], serial: previous.serial + 1 }));
    editor(action);
    await user.click(screen.getByRole('button', { name: 'Editar' }));
    await user.type(screen.getByRole('textbox', { name: 'Conteúdo' }), ' Mais.');

    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    const content = screen.getByRole('textbox', { name: 'Conteúdo' });
    await waitFor(() => expect(document.activeElement).toBe(content));
    expect(content.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(content.getAttribute('aria-describedby')!)?.textContent).toBe('O conteúdo pode ter até 20000 caracteres.');
    expect(content).toHaveProperty('value', 'Forjada no norte. Mais.');

    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(screen.getByRole('textbox', { name: 'Nome' }).getAttribute('aria-invalid')).toBe('true');
    expect(content.getAttribute('aria-invalid')).toBe('false');

    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(screen.getByRole('alert').textContent).toBe('Não encontrado.');
    expect(screen.getByRole('form')).toBeTruthy();
    // The saved line is said only once a save is stored, never beside an open form.
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('a stale save says so with both choices: the GM\'s draft kept as a new version, or the current version read again', async () => {
    const user = userEvent.setup();
    const action = vi.fn<EditAction>(async (previous, form) =>
      form.get('version') === '2'
        ? { ...NO_ARTIFACT_EDIT, serial: previous.serial + 1, stale: true, currentVersion: 3 }
        : { ...NO_ARTIFACT_EDIT, serial: previous.serial + 1, saved: true, currentVersion: 4 },
    );
    editor(action);
    await user.click(screen.getByRole('button', { name: 'Editar' }));
    await user.type(screen.getByRole('textbox', { name: 'Nome' }), ' (aba B)');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Este item mudou em outra aba.');
    expect(within(alert).getByRole('button', { name: 'Ver a versão atual' })).toBeTruthy();
    const keep = within(alert).getByRole('button', { name: 'Manter a minha como nova versão' });
    keep.focus();
    await user.keyboard('{Enter}');

    expect(posted(action.mock.calls[1]![1])).toMatchObject({ version: '3', name: 'Espada de Kael (aba B)', content: 'Forjada no norte.' });
    await waitFor(() => expect(screen.queryByRole('form')).toBeNull());
  });

  it('"Ver a versão atual" closes the form and reads the page again; in English too', async () => {
    const user = userEvent.setup();
    const action = vi.fn<EditAction>(async (previous) => ({ ...NO_ARTIFACT_EDIT, serial: previous.serial + 1, stale: true, currentVersion: 3 }));
    editor(action, 'en');
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert').textContent).toContain('This item changed in another tab.');
    await user.click(screen.getByRole('button', { name: 'See the current version' }));
    expect(routerRefresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('form')).toBeNull();
    // Opened again, nothing of the earlier answer shows; "Cancel" closes it.
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.queryByRole('alert')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('form')).toBeNull();
    await act(async () => undefined);
    expect(action).toHaveBeenCalledTimes(1);
  });
});

function versions(action: RestoreAction, older = false) {
  return render(
    <ArtifactVersions
      campaignId={CAMPAIGN}
      artifactId={ARTIFACT}
      currentVersion={3}
      rows={[
        { number: 3, label: 'Versão 3 · Espada Rubra · 26 de nov. de 2026', href: `/a`, current: true, shown: !older },
        { number: 2, label: 'Versão 2 · Espada · 26 de nov. de 2026', href: `/a?version=2&via=versions`, current: false, shown: false },
        { number: 1, label: 'Versão 1 · Espada de Kael · 25 de nov. de 2026', href: `/a?version=1&via=versions`, current: false, shown: older },
      ]}
      pages={{ paging: { page: 1, pages: 1, total: 3, from: 1, to: 3 }, path: '/a', query: {} }}
      older={older}
      from={older ? 'characters' : null}
      texts={artifactVersionsTexts(translator('pt-BR'))}
      language="pt-BR"
      action={action}
    />,
  );
}

describe('an artifact\'s "Versões" (Story 5.2)', () => {
  it('lists the versions newest first, the newest tagged "atual", each other with "Restaurar", which restores it on the newest version', async () => {
    const user = userEvent.setup();
    const action = vi.fn<RestoreAction>(async (previous, form) => ({
      ...NO_ARTIFACT_RESTORE,
      serial: previous.serial + 1,
      number: Number(form.get('number')),
      saved: true,
      currentVersion: 4,
    }));
    versions(action);

    const list = screen.getByRole('list', { name: 'Versões deste artefato' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((row) => within(row).getByRole('link').textContent)).toEqual([
      'Versão 3 · Espada Rubra · 26 de nov. de 2026',
      'Versão 2 · Espada · 26 de nov. de 2026',
      'Versão 1 · Espada de Kael · 25 de nov. de 2026',
    ]);
    expect(within(rows[0]!).getByRole('link').getAttribute('aria-current')).toBe('page');
    expect(within(rows[1]!).getByRole('link').getAttribute('href')).toBe('/a?version=2&via=versions');
    expect(rows[0]!.textContent).toContain('atual');
    expect(within(rows[0]!).queryByRole('button')).toBeNull();
    expect(within(rows[2]!).getByRole('button', { name: 'Restaurar a versão 1' }).textContent).toContain('Restaurar');

    await user.click(within(rows[2]!).getByRole('button', { name: 'Restaurar a versão 1' }));

    const form = action.mock.calls[0]![1];
    expect(Object.fromEntries(form.entries())).toEqual({ campaignId: CAMPAIGN, artifactId: ARTIFACT, number: '1', version: '3', view: 'current' });
    await act(async () => undefined);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a stale restore says so with both choices: the same restore on the newest version, or the page read again', async () => {
    const user = userEvent.setup();
    const action = vi.fn<RestoreAction>(async (previous, form) =>
      form.get('version') === '3'
        ? { ...NO_ARTIFACT_RESTORE, serial: previous.serial + 1, number: 1, stale: true, currentVersion: 4 }
        : { ...NO_ARTIFACT_RESTORE, serial: previous.serial + 1, number: 1, saved: true, currentVersion: 5 },
    );
    versions(action, true);
    await user.click(screen.getByRole('button', { name: 'Restaurar a versão 1' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Este item mudou em outra aba.');
    // A restore has no draft of the GM's own: its second choice restores the same version anyway.
    expect(within(alert).queryByRole('button', { name: 'Manter a minha como nova versão' })).toBeNull();
    await user.click(within(alert).getByRole('button', { name: 'Restaurar a versão 1 mesmo assim' }));
    expect(Object.fromEntries(action.mock.calls[1]![1].entries())).toEqual({
      campaignId: CAMPAIGN,
      artifactId: ARTIFACT,
      number: '1',
      version: '4',
      view: 'older',
      from: 'characters',
    });
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('"Ver a versão atual" reads the page again and sets the notice aside; another refusal shows as an alert', async () => {
    const user = userEvent.setup();
    const answers: Partial<ArtifactRestoreState>[] = [
      { stale: true, currentVersion: 4 },
      { error: 'O tipo de registro desta versão não existe mais no sistema desta campanha.' },
    ];
    const action = vi.fn<RestoreAction>(async (previous) => ({ ...NO_ARTIFACT_RESTORE, ...answers[previous.serial], number: 2, serial: previous.serial + 1 }));
    versions(action);
    await user.click(screen.getByRole('button', { name: 'Restaurar a versão 2' }));
    await user.click(await screen.findByRole('button', { name: 'Ver a versão atual' }));
    expect(routerRefresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Restaurar a versão 2' }));
    expect((await screen.findByRole('alert')).textContent).toBe('O tipo de registro desta versão não existe mais no sistema desta campanha.');
  });
});
