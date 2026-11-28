import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NO_PARTY_ANSWER, type PartyFormState } from '@/app/(signed-in)/campaigns/form-state';
import { PartyForm } from '@/components/PartyForm';

const ptBR = (await import('@/messages/pt-BR.json')).default;
const en = (await import('@/messages/en.json')).default;

const ID = '0190a0b0-0000-7000-8000-000000000002';

afterEach(() => cleanup());

type Action = (previous: PartyFormState, form: FormData) => Promise<PartyFormState>;

function party(action: Action, options: { size?: number | null; level?: number | null; messages?: typeof ptBR } = {}) {
  const messages = options.messages ?? ptBR;
  const size = options.size === undefined ? null : options.size;
  const level = options.level === undefined ? null : options.level;
  return render(
    <PartyForm
      id={ID}
      version={3}
      size={size}
      level={level}
      purpose={size === null || level === null ? messages.campaigns.page.partyPurpose : null}
      texts={messages.campaigns.party}
      action={action}
    />,
  );
}

const answered = (previous: PartyFormState, fields: Partial<PartyFormState>): PartyFormState => ({
  ...NO_PARTY_ANSWER,
  ...fields,
  serial: previous.serial + 1,
});

describe("a campaign overview's party (Story 7.1)", () => {
  it('unset: the purpose sentence and "Alterar"; the form opens with two empty bordered fields and the level hint, in both languages', async () => {
    const user = userEvent.setup();
    for (const messages of [ptBR, en]) {
      party(vi.fn<Action>(), { messages });
      const section = screen.getByRole('region', { name: messages.campaigns.party.label });
      expect(within(section).getByText(messages.campaigns.page.partyPurpose)).toBeTruthy();
      expect(within(section).queryByRole('form')).toBeNull();

      await user.click(within(section).getByRole('button', { name: messages.campaigns.party.change }));
      const form = within(section).getByRole('form', { name: messages.campaigns.party.formLabel });
      const size = within(form).getByRole('textbox', { name: messages.campaigns.party.size }) as HTMLInputElement;
      const level = within(form).getByRole('textbox', { name: messages.campaigns.party.level }) as HTMLInputElement;
      expect(size.value).toBe('');
      expect(level.value).toBe('');
      expect(size.inputMode).toBe('numeric');
      expect(within(form).getByText(messages.campaigns.party.levelHint)).toBeTruthy();
      expect(level.getAttribute('aria-describedby')).toBe(within(form).getByText(messages.campaigns.party.levelHint).id);
      // "Cancelar" closes it again.
      await user.click(within(form).getByRole('button', { name: messages.campaigns.party.cancel }));
      expect(within(section).queryByRole('form')).toBeNull();
      cleanup();
    }
  });

  it('set: no purpose sentence; the form starts from the values; a save posts them on the version and closes, focus on "Alterar"', async () => {
    const user = userEvent.setup();
    const action = vi.fn<Action>(async (previous, form) => {
      expect(form.get('id')).toBe(ID);
      expect(form.get('version')).toBe('3');
      expect(form.get('size')).toBe('5');
      expect(form.get('level')).toBe('');
      return answered(previous, { version: 4, size: 5, level: null, saved: true });
    });
    party(action, { size: 4, level: 7 });
    const section = screen.getByRole('region', { name: 'Grupo' });
    expect(within(section).queryByText(ptBR.campaigns.page.partyPurpose)).toBeNull();

    await user.click(within(section).getByRole('button', { name: 'Alterar' }));
    const form = within(section).getByRole('form', { name: 'Grupo da campanha' });
    const size = within(form).getByRole('textbox', { name: 'Jogadores' }) as HTMLInputElement;
    const level = within(form).getByRole('textbox', { name: 'Nível do grupo' }) as HTMLInputElement;
    expect(size.value).toBe('4');
    expect(level.value).toBe('7');
    await user.clear(size);
    await user.type(size, '5');
    // Empty clears the level.
    await user.clear(level);
    await user.click(within(form).getByRole('button', { name: 'Salvar' }));

    expect(action).toHaveBeenCalledOnce();
    expect(within(section).queryByRole('form')).toBeNull();
    expect(document.activeElement).toBe(within(section).getByRole('button', { name: 'Alterar' }));
  });

  it('a refusal stays beside its field with what was typed; the form stays open', async () => {
    const user = userEvent.setup();
    const action = vi.fn<Action>(async (previous) =>
      answered(previous, { error: 'Informe um número inteiro de 1 a 999.', field: 'level' }),
    );
    party(action);
    await user.click(screen.getByRole('button', { name: 'Alterar' }));
    const form = screen.getByRole('form', { name: 'Grupo da campanha' });
    const level = within(form).getByRole('textbox', { name: 'Nível do grupo' }) as HTMLInputElement;
    await user.type(level, '1000');
    await user.click(within(form).getByRole('button', { name: 'Salvar' }));

    const alert = await within(form).findByRole('alert');
    expect(alert.textContent).toBe('Informe um número inteiro de 1 a 999.');
    expect(level.getAttribute('aria-invalid')).toBe('true');
    expect(level.getAttribute('aria-describedby')).toContain(alert.id);
    expect(level.value).toBe('1000');
    expect(within(form).getByRole('textbox', { name: 'Jogadores' }).getAttribute('aria-invalid')).toBe('false');
  });

  it('after a refusal, "Cancelar" and "Alterar" open the form again on the page\'s values with no refusal or stale line', async () => {
    const user = userEvent.setup();
    const answers: PartyFormState[] = [];
    const action = vi.fn<Action>(async (previous) => {
      const next =
        answers.length === 0
          ? answered(previous, { error: 'Informe um número inteiro de 1 a 999.', field: 'level' })
          : answered(previous, { version: 6, size: 3, level: 12, error: ptBR.campaigns.party.stale, stale: true });
      answers.push(next);
      return next;
    });
    party(action, { size: 4, level: 5 });
    // Once after a refusal beside a field, once after a stale answer.
    for (let round = 0; round < 2; round += 1) {
      await user.click(screen.getByRole('button', { name: 'Alterar' }));
      const form = screen.getByRole('form', { name: 'Grupo da campanha' });
      await user.clear(within(form).getByRole('textbox', { name: 'Nível do grupo' }));
      await user.type(within(form).getByRole('textbox', { name: 'Nível do grupo' }), '1000');
      await user.click(within(form).getByRole('button', { name: 'Salvar' }));
      expect(await within(form).findByRole('alert')).toBeTruthy();
      await user.click(within(form).getByRole('button', { name: 'Cancelar' }));

      await user.click(screen.getByRole('button', { name: 'Alterar' }));
      const again = screen.getByRole('form', { name: 'Grupo da campanha' });
      expect(within(again).queryByRole('alert')).toBeNull();
      expect((within(again).getByRole('textbox', { name: 'Jogadores' }) as HTMLInputElement).value).toBe('4');
      expect((within(again).getByRole('textbox', { name: 'Nível do grupo' }) as HTMLInputElement).value).toBe('5');
      expect(within(again).getByRole('textbox', { name: 'Nível do grupo' }).getAttribute('aria-invalid')).toBe('false');
      // The version the next save names is the page's (a stale answer's newer version comes with the page's refresh).
      expect((again.querySelector('input[name="version"]') as HTMLInputElement).value).toBe('3');
      await user.click(within(again).getByRole('button', { name: 'Cancelar' }));
    }
  });

  it('a stale save keeps the form open on the current values with the stale line, and the next save names the new version', async () => {
    const user = userEvent.setup();
    const versions: (FormDataEntryValue | null)[] = [];
    const action = vi.fn<Action>(async (previous, form) => {
      versions.push(form.get('version'));
      return versions.length === 1
        ? answered(previous, { version: 6, size: 3, level: 12, error: ptBR.campaigns.party.stale, stale: true })
        : answered(previous, { version: 7, size: 3, level: 12, saved: true });
    });
    party(action, { size: 4, level: 5 });
    await user.click(screen.getByRole('button', { name: 'Alterar' }));
    const form = screen.getByRole('form', { name: 'Grupo da campanha' });
    await user.clear(within(form).getByRole('textbox', { name: 'Jogadores' }));
    await user.type(within(form).getByRole('textbox', { name: 'Jogadores' }), '6');
    await user.click(within(form).getByRole('button', { name: 'Salvar' }));

    expect((await within(form).findByRole('alert')).textContent).toBe(ptBR.campaigns.party.stale);
    expect((within(form).getByRole('textbox', { name: 'Jogadores' }) as HTMLInputElement).value).toBe('3');
    expect((within(form).getByRole('textbox', { name: 'Nível do grupo' }) as HTMLInputElement).value).toBe('12');
    await user.click(within(form).getByRole('button', { name: 'Salvar' }));
    expect(versions).toEqual(['3', '6']);
    expect(screen.queryByRole('form')).toBeNull();
  });
});
