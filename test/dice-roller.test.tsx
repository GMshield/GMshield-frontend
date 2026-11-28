import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { DiceRoller } = await import('@/components/DiceRoller');
const { translator } = await import('@/messages');
type Language = import('@/messages').Language;

function labelsFor(language: Language) {
  const t = translator(language);
  return {
    title: t('shields.dice.title'),
    formula: t('shields.dice.formula'),
    roll: t('shields.dice.roll'),
    invalid: t('shields.dice.invalid'),
    sentence: t('shields.dice.sentence'),
    die: t('shields.dice.die'),
  };
}

/** `crypto.getRandomValues` giving `values` in turn (each a Uint32), so the faces are known: value % S + 1. */
function scriptRandom(values: readonly number[]) {
  let next = 0;
  return vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(<T extends ArrayBufferView | null>(array: T): T => {
    const target = array as unknown as Uint32Array;
    for (let index = 0; index < target.length; index += 1) {
      target[index] = values[next % values.length] ?? 0;
      next += 1;
    }
    return array;
  });
}

/** The polite live region, and what it says. */
function liveRegion(container: HTMLElement): HTMLElement {
  const region = container.querySelector<HTMLElement>('[aria-live="polite"]');
  expect(region).not.toBeNull();
  return region!;
}

function result(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-testid="dice-result"]');
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('the dice roller (Story 6.3)', () => {
  it('shows the die buttons d4 to d100 in order, then the "Fórmula" field and an outlined "Rolar", in both languages', () => {
    for (const language of ['pt-BR', 'en'] as const) {
      const labels = labelsFor(language);
      const { container, unmount } = render(<DiceRoller labels={labels} />);

      expect(screen.getByRole('heading', { level: 2, name: labels.title })).toBeTruthy();
      const group = screen.getByRole('group', { name: labels.die });
      expect(within(group).getAllByRole('button').map((button) => button.textContent)).toEqual(['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100']);
      const field = screen.getByRole('textbox', { name: labels.formula });
      expect(field.getAttribute('aria-invalid')).toBe('false');
      const submit = screen.getByRole('button', { name: labels.roll });
      expect(submit.getAttribute('type')).toBe('submit');
      // Outlined: the Shield screen's one solid pill is the header's "Nova nota".
      expect(submit.getAttribute('data-variant')).toBe('default');
      // Nothing rolled yet: no result and a silent live region.
      expect(result(container)).toBeNull();
      expect(liveRegion(container).textContent).toBe('');
      expect(container.querySelectorAll('[style]')).toHaveLength(0);
      unmount();
    }
  });

  it('a die button rolls one die of its kind at once: "1d20", its result and the total, said in one sentence', async () => {
    const user = userEvent.setup();
    scriptRandom([16]);
    const { container } = render(<DiceRoller labels={labelsFor('pt-BR')} />);

    await user.click(screen.getByRole('button', { name: 'd20' }));

    expect(result(container)?.textContent).toBe('1d201717');
    expect(liveRegion(container).textContent).toBe('1d20: 17, total 17');
  });

  it('every die button stays within its range with the real source', async () => {
    const user = userEvent.setup();
    const { container } = render(<DiceRoller labels={labelsFor('en')} />);
    for (const sides of [4, 6, 8, 10, 12, 20, 100]) {
      await user.click(screen.getByRole('button', { name: `d${sides}` }));
      const sentence = liveRegion(container).textContent ?? '';
      const match = /^1d(\d+): (\d+), total (\d+)$/.exec(sentence);
      expect(match).not.toBeNull();
      expect(Number(match![1])).toBe(sides);
      expect(Number(match![2])).toBeGreaterThanOrEqual(1);
      expect(Number(match![2])).toBeLessThanOrEqual(sides);
      expect(match![3]).toBe(match![2]);
    }
  });

  it('a formula submitted with Enter rolls it, normalised: " 2D6 + 3 " shows "2d6+3", the dice and the total', async () => {
    const user = userEvent.setup();
    scriptRandom([3, 4]);
    const labels = labelsFor('pt-BR');
    const { container } = render(<DiceRoller labels={labels} />);

    const field = screen.getByRole('textbox', { name: labels.formula });
    await user.type(field, ' 2D6 + 3 {Enter}');

    const shown = result(container)!;
    expect(shown.children.item(0)?.textContent).toBe('2d6+3');
    expect(shown.children.item(1)?.textContent).toBe('12');
    expect(shown.children.item(2)?.textContent).toBe('4, 5');
    expect(liveRegion(container).textContent).toBe('2d6+3: 4, 5, total 12');
    // The field keeps what was typed, so the same roll is one more Enter away.
    expect((field as HTMLInputElement).value).toBe(' 2D6 + 3 ');
  });

  it('shows only the latest roll: each roll replaces the one before', async () => {
    const user = userEvent.setup();
    scriptRandom([0, 7, 5, 0]);
    const labels = labelsFor('en');
    const { container } = render(<DiceRoller labels={labels} />);

    await user.click(screen.getByRole('button', { name: 'd4' }));
    expect(liveRegion(container).textContent).toBe('1d4: 1, total 1');
    await user.type(screen.getByRole('textbox', { name: labels.formula }), '1d8+2d6-1');
    await user.click(screen.getByRole('button', { name: labels.roll }));

    expect(container.querySelectorAll('[data-testid="dice-result"]')).toHaveLength(1);
    expect(liveRegion(container).textContent).toBe('1d8+2d6-1: 8, 6, 1, total 14');
    expect(result(container)?.children.item(1)?.textContent).toBe('14');
  });

  it('announces an identical roll again: the sentence is a new node each time', async () => {
    const user = userEvent.setup();
    scriptRandom([5]);
    const { container } = render(<DiceRoller labels={labelsFor('pt-BR')} />);

    await user.click(screen.getByRole('button', { name: 'd6' }));
    const first = liveRegion(container).firstElementChild;
    expect(first?.textContent).toBe('1d6: 6, total 6');
    await user.click(screen.getByRole('button', { name: 'd6' }));
    const second = liveRegion(container).firstElementChild;

    expect(second?.textContent).toBe('1d6: 6, total 6');
    expect(second).not.toBe(first);
    expect(liveRegion(container).getAttribute('aria-atomic')).toBe('true');
  });

  it('refuses an unreadable formula: the text stays, the field is invalid with the message under it, nothing is rolled', async () => {
    for (const language of ['pt-BR', 'en'] as const) {
      const user = userEvent.setup();
      scriptRandom([1]);
      const labels = labelsFor(language);
      const { container, unmount } = render(<DiceRoller labels={labels} />);
      await user.click(screen.getByRole('button', { name: 'd8' }));
      const before = liveRegion(container).textContent;
      expect(before).toBe('1d8: 2, total 2');
      const getRandomValues = vi.mocked(globalThis.crypto.getRandomValues);
      getRandomValues.mockClear();

      for (const text of ['1d7', 'd3', 'abc', '60d6+41d4', '0d6', '+2d6', '2d6+', '3']) {
        const field = screen.getByRole('textbox', { name: labels.formula }) as HTMLInputElement;
        await user.clear(field);
        await user.type(field, `${text}{Enter}`);

        expect(field.value).toBe(text);
        expect(field.getAttribute('aria-invalid')).toBe('true');
        const message = screen.getByRole('alert');
        expect(message.textContent).toBe(labels.invalid);
        expect(field.getAttribute('aria-describedby')).toBe(message.id);
        // The last result stays and nothing was drawn.
        expect(liveRegion(container).textContent).toBe(before);
        expect(result(container)?.children.item(1)?.textContent).toBe('2');
      }
      // The empty field is refused the same way, with the button.
      await user.clear(screen.getByRole('textbox', { name: labels.formula }));
      await user.click(screen.getByRole('button', { name: labels.roll }));
      expect(screen.getByRole('alert').textContent).toBe(labels.invalid);
      expect(getRandomValues).not.toHaveBeenCalled();
      unmount();
      vi.restoreAllMocks();
    }
    expect(labelsFor('pt-BR').invalid).toBe('Use o formato 2d6+3.');
    expect(labelsFor('en').invalid).toBe('Use the format 2d6+3.');
  });

  it('clears the message when the text changes', async () => {
    const user = userEvent.setup();
    const labels = labelsFor('pt-BR');
    render(<DiceRoller labels={labels} />);
    const field = screen.getByRole('textbox', { name: labels.formula });

    await user.type(field, '1d7{Enter}');
    expect(screen.getByRole('alert')).toBeTruthy();
    await user.type(field, '{Backspace}');

    expect(screen.queryByRole('alert')).toBeNull();
    expect(field.getAttribute('aria-invalid')).toBe('false');
    expect(field.getAttribute('aria-describedby')).toBeNull();
  });

  it('a die button pressed while the message shows rolls and clears it, the text kept', async () => {
    const user = userEvent.setup();
    scriptRandom([9]);
    const labels = labelsFor('pt-BR');
    const { container } = render(<DiceRoller labels={labels} />);
    const field = screen.getByRole('textbox', { name: labels.formula }) as HTMLInputElement;

    await user.type(field, '1d7{Enter}');
    expect(screen.getByRole('alert')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'd12' }));

    expect(liveRegion(container).textContent).toBe('1d12: 10, total 10');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(field.getAttribute('aria-invalid')).toBe('false');
    expect(field.getAttribute('aria-describedby')).toBeNull();
    expect(field.value).toBe('1d7');
  });

  it('rolls offline as online, and never calls fetch or writes to browser storage', async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    globalThis.dispatchEvent(new Event('offline'));
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('offline'));
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    scriptRandom([19, 2, 3]);
    const labels = labelsFor('en');
    const { container } = render(<DiceRoller labels={labels} />);

    expect(navigator.onLine).toBe(false);
    await user.click(screen.getByRole('button', { name: 'd20' }));
    expect(liveRegion(container).textContent).toBe('1d20: 20, total 20');
    await user.type(screen.getByRole('textbox', { name: labels.formula }), '2d6+3{Enter}');
    expect(liveRegion(container).textContent).toBe('2d6+3: 3, 4, total 10');

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
  });

  it('never uses Math.random', async () => {
    const user = userEvent.setup();
    const random = vi.spyOn(Math, 'random');
    render(<DiceRoller labels={labelsFor('pt-BR')} />);
    for (const name of ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100']) {
      await user.click(screen.getByRole('button', { name }));
    }
    expect(random).not.toHaveBeenCalled();
  });
});
