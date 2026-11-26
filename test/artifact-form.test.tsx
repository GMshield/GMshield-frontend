import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

/** Story 5.1: a new artifact's form, its record body shared with a record's correction (test/record-correction.test.tsx). */
const { ArtifactForm } = await import('@/components/ArtifactForm');
type ArtifactFormState = import('@/app/(signed-in)/campaigns/[id]/artifacts/form-state').ArtifactFormState;

const CAMPAIGN = '0190a0b0-0000-7000-8000-000000000002';

afterEach(() => {
  cleanup();
});

describe("a new artifact's form (Story 5.1)", () => {
  it('posts what is shown, keeps what was typed after a refusal, shows it under its part and moves the focus there', async () => {
    const user = userEvent.setup();
    const sent: FormData[] = [];
    const action = vi.fn(async (previous: ArtifactFormState, form: FormData): Promise<ArtifactFormState> => {
      sent.push(form);
      return { serial: previous.serial + 1, values: previous.values, error: 'O valor do campo precisa ter de 1 a 8000 caracteres.', field: 'fieldValue:0' };
    });
    render(
      <ArtifactForm
        campaignId={CAMPAIGN}
        types={[
          { key: 'item', label: 'Item' },
          { key: 'note', label: 'Nota' },
        ]}
        texts={{
          name: 'Nome',
          type: 'Tipo',
          fields: 'Campos',
          fieldName: 'Nome do campo',
          fieldValue: 'Valor',
          fieldNameOf: 'Nome do campo {number}',
          fieldValueOf: 'Valor do campo {number}',
          noFields: 'Nenhum campo.',
          addField: 'Adicionar campo',
          removeField: 'Remover campo',
          removeFieldOf: 'Remover campo {number}',
          form: 'Novo artefato',
          content: 'Conteúdo',
          save: 'Salvar',
          cancel: 'Cancelar',
        }}
        initial={{ serial: 0, values: { recordType: 'note', name: '', fields: [], content: '' }, error: null, field: null }}
        cancelHref={`/campaigns/${CAMPAIGN}?tab=artifacts`}
        action={action}
      />,
    );
    // The focus starts on the name.
    expect(document.activeElement).toBe(screen.getByLabelText('Nome'));
    await user.type(screen.getByLabelText('Nome'), 'Espada de Kael');
    await user.selectOptions(screen.getByLabelText('Tipo'), 'item');
    await user.click(screen.getByRole('button', { name: 'Adicionar campo' }));
    expect(document.activeElement).toBe(screen.getByLabelText('Nome do campo 1'));
    await user.type(screen.getByLabelText('Nome do campo 1'), 'Dano');
    await user.type(screen.getByLabelText('Conteúdo'), 'Forjada no norte.');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(action).toHaveBeenCalledTimes(1);
    const posted = sent[0]!;
    expect(posted.get('campaignId')).toBe(CAMPAIGN);
    expect(posted.get('name')).toBe('Espada de Kael');
    expect(posted.get('recordType')).toBe('item');
    expect(posted.getAll('fieldName')).toEqual(['Dano']);
    expect(posted.getAll('fieldValue')).toEqual(['']);
    expect(posted.get('content')).toBe('Forjada no norte.');
    // The refusal under the field's value, with what was typed kept, and the focus on it.
    const value = await screen.findByLabelText('Valor do campo 1');
    expect(value.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(value.getAttribute('aria-describedby')!)?.textContent).toBe('O valor do campo precisa ter de 1 a 8000 caracteres.');
    expect(document.activeElement).toBe(value);
    expect((screen.getByLabelText('Nome') as HTMLInputElement).value).toBe('Espada de Kael');
    expect((screen.getByLabelText('Conteúdo') as HTMLTextAreaElement).value).toBe('Forjada no norte.');
    expect(screen.getByRole('link', { name: 'Cancelar' }).getAttribute('href')).toBe(`/campaigns/${CAMPAIGN}?tab=artifacts`);
  });

  it('shows a refusal of the content under it', async () => {
    const user = userEvent.setup();
    const action = vi.fn(async (previous: ArtifactFormState): Promise<ArtifactFormState> => ({
      serial: previous.serial + 1,
      values: previous.values,
      error: 'O conteúdo pode ter até 20000 caracteres.',
      field: 'content',
    }));
    render(
      <ArtifactForm
        campaignId={CAMPAIGN}
        types={[{ key: 'note', label: 'Nota' }]}
        texts={{
          name: 'Nome',
          type: 'Tipo',
          fields: 'Campos',
          fieldName: 'Nome do campo',
          fieldValue: 'Valor',
          fieldNameOf: 'Nome do campo {number}',
          fieldValueOf: 'Valor do campo {number}',
          noFields: 'Nenhum campo.',
          addField: 'Adicionar campo',
          removeField: 'Remover campo',
          removeFieldOf: 'Remover campo {number}',
          form: 'Novo artefato',
          content: 'Conteúdo',
          save: 'Salvar',
          cancel: 'Cancelar',
        }}
        initial={{ serial: 0, values: { recordType: 'note', name: 'Nota', fields: [], content: '' }, error: null, field: null }}
        cancelHref="/campaigns"
        action={action}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    const content = await screen.findByLabelText('Conteúdo');
    expect(content.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('alert').textContent).toBe('O conteúdo pode ter até 20000 caracteres.');
    expect(document.activeElement).toBe(content);
  });
});
