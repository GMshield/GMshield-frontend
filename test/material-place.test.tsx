import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MaterialPlace, NO_PLACE_ANSWER, type PlaceFormState } from '@/components/MaterialPlace';
import type { Belonging, Place } from '@/components/uploads/types';

const ptBR = (await import('@/messages/pt-BR.json')).default;

const ID = '0190a0b0-0000-7000-8000-000000000003';
const CAMPAIGN = '0190a0b0-0000-7000-8000-000000000002';
const SYSTEM = '0190a0b0-0000-7000-8000-000000000001';
const PATHFINDER = '0190a0b0-0000-7000-8000-000000000030';
const PLACES: Belonging = {
  campaigns: [{ id: CAMPAIGN, name: 'Primeira campanha', system: { id: SYSTEM, name: 'D&D' } }],
  systems: [
    { id: SYSTEM, name: 'D&D' },
    { id: PATHFINDER, name: 'Pathfinder' },
  ],
  current: null,
};
const TEXTS = {
  ...ptBR.material.belonging,
  picker: ptBR.upload.dialog.belonging,
};

afterEach(() => cleanup());

function place(
  action: (previous: PlaceFormState, form: FormData) => Promise<PlaceFormState>,
  options: { place?: Place | null; places?: Belonging; unavailable?: string | null } = {},
) {
  return render(
    <MaterialPlace
      id={ID}
      version={2}
      summary="Na campanha Primeira campanha, do sistema D&D."
      place={options.place === undefined ? { choice: 'campaign', campaign: CAMPAIGN } : options.place}
      places={options.places ?? PLACES}
      unavailable={options.unavailable ?? null}
      texts={TEXTS}
      action={action}
    />,
  );
}

describe('a material page\'s "Onde pertence" (Story 3.3)', () => {
  it('says where it belongs; "Alterar" opens the three rows on the current place; a save closes it and says when it applies', async () => {
    const user = userEvent.setup();
    const action = vi.fn(async (previous: PlaceFormState, form: FormData): Promise<PlaceFormState> => {
      expect(form.get('id')).toBe(ID);
      expect(form.get('version')).toBe('2');
      expect(form.get('belonging')).toBe('systems');
      expect(form.getAll('systems')).toEqual([SYSTEM, PATHFINDER]);
      return { version: 3, place: { choice: 'systems', systems: [SYSTEM, PATHFINDER] }, error: null, stale: false, saved: true, serial: previous.serial + 1, reset: previous.reset + 1 };
    });
    place(action);
    const section = screen.getByRole('region', { name: 'Onde pertence' });
    expect(within(section).getByText('Na campanha Primeira campanha, do sistema D&D.')).toBeTruthy();
    expect(screen.queryByRole('form')).toBeNull();

    await user.click(within(section).getByRole('button', { name: 'Alterar' }));
    const form = within(section).getByRole('form', { name: 'Onde este arquivo fica' });
    expect((within(form).getByRole('radio', { name: /Uma campanha/ }) as HTMLInputElement).checked).toBe(true);
    expect((within(form).getByRole('combobox', { name: 'Campanha' }) as HTMLSelectElement).value).toBe(CAMPAIGN);
    await user.click(within(form).getByRole('checkbox', { name: 'D&D' }));
    await user.click(within(form).getByRole('checkbox', { name: 'Pathfinder' }));
    expect((within(form).getByRole('radio', { name: /Vários sistemas/ }) as HTMLInputElement).checked).toBe(true);
    await user.click(within(form).getByRole('button', { name: 'Salvar' }));

    expect(action).toHaveBeenCalledOnce();
    expect(await within(section).findByRole('status')).toBeTruthy();
    expect(within(section).getByRole('status').textContent).toBe('Vale a partir da próxima pergunta.');
    expect(within(section).queryByRole('form')).toBeNull();
    expect(document.activeElement).toBe(within(section).getByRole('button', { name: 'Alterar' }));
  });

  it('a stale save keeps the form open on the current place with the stale line, and the next save names its version', async () => {
    const user = userEvent.setup();
    const versions: (string | null)[] = [];
    const action = vi.fn(async (previous: PlaceFormState, form: FormData): Promise<PlaceFormState> => {
      versions.push(form.get('version') as string | null);
      return versions.length === 1
        ? { version: 7, place: { choice: 'system', system: PATHFINDER }, error: TEXTS.stale, stale: true, saved: false, serial: previous.serial + 1, reset: previous.reset + 1 }
        : { ...previous, error: 'O pedido não é válido.', stale: false, saved: false, serial: previous.serial + 1 };
    });
    place(action);
    await user.click(screen.getByRole('button', { name: 'Alterar' }));
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    expect((await screen.findByRole('alert')).textContent).toBe(TEXTS.stale);
    const form = screen.getByRole('form', { name: 'Onde este arquivo fica' });
    expect((within(form).getByRole('radio', { name: /Um sistema/ }) as HTMLInputElement).checked).toBe(true);
    expect((within(form).getByRole('combobox', { name: 'Sistema' }) as HTMLSelectElement).value).toBe(PATHFINDER);
    // Another refusal keeps what the GM chose.
    await user.click(within(form).getByRole('checkbox', { name: 'D&D' }));
    await act(async () => user.click(within(form).getByRole('button', { name: 'Salvar' })));
    expect(versions).toEqual(['2', '7']);
    expect((await screen.findByRole('alert')).textContent).toBe('O pedido não é válido.');
    expect((within(form).getByRole('checkbox', { name: 'D&D' }) as HTMLInputElement).checked).toBe(true);
    // "Cancelar" closes it without saving.
    await user.click(within(form).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('form')).toBeNull();
    expect(NO_PLACE_ANSWER.serial).toBe(0);
  });

  it('a material in an archived campaign opens with nothing picked, and "Salvar" posts nothing until a place is picked', async () => {
    const user = userEvent.setup();
    const action = vi.fn(async (previous: PlaceFormState): Promise<PlaceFormState> => previous);
    place(action, { place: { choice: 'campaign', campaign: '0190a0b0-0000-7000-8000-000000000099' } });

    await user.click(screen.getByRole('button', { name: 'Alterar' }));
    const form = screen.getByRole('form', { name: 'Onde este arquivo fica' });
    for (const radio of within(form).getAllByRole('radio')) {
      expect((radio as HTMLInputElement).checked).toBe(false);
    }
    expect((within(form).getByRole('combobox', { name: 'Campanha' }) as HTMLSelectElement).value).toBe('');
    expect((within(form).getByRole('combobox', { name: 'Sistema' }) as HTMLSelectElement).value).toBe('');
    const save = within(form).getByRole('button', { name: 'Salvar' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    await user.click(save);
    // Choosing a row whose select has nothing picked, or several systems with none ticked, is still no place.
    await user.click(within(form).getByRole('radio', { name: /Uma campanha/ }));
    expect(save.disabled).toBe(true);
    await user.click(within(form).getByRole('radio', { name: /Vários sistemas/ }));
    expect(save.disabled).toBe(true);
    expect(action).not.toHaveBeenCalled();
    await user.selectOptions(within(form).getByRole('combobox', { name: 'Campanha' }), CAMPAIGN);
    expect(save.disabled).toBe(false);
  });

  it('never offers "Em nenhum lugar", and says why when the campaigns and systems could not be loaded', async () => {
    const user = userEvent.setup();
    const action = vi.fn(async (previous: PlaceFormState): Promise<PlaceFormState> => previous);
    const { unmount } = place(action, { places: { campaigns: [], systems: [], current: null }, unavailable: 'O serviço está indisponível agora.' });
    expect(screen.queryByRole('button', { name: 'Alterar' })).toBeNull();
    expect(screen.getByText('O serviço está indisponível agora.')).toBeTruthy();
    unmount();
    place(action, { place: null, places: { campaigns: [], systems: [{ id: SYSTEM, name: 'D&D' }], current: null } });
    await user.click(screen.getByRole('button', { name: 'Alterar' }));
    // A material with no place opens with nothing picked too; "Em nenhum lugar" is not a choice.
    expect(screen.getAllByRole('radio').map((radio) => (radio as HTMLInputElement).value)).toEqual(['system', 'systems']);
    expect(screen.getAllByRole('radio').some((radio) => (radio as HTMLInputElement).checked)).toBe(false);
    expect((screen.getByRole('button', { name: 'Salvar' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
