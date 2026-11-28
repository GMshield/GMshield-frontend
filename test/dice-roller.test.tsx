import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => '/campaigns/x/shields/y',
  useRouter: () => ({ refresh: () => undefined, push: () => undefined, replace: () => undefined, prefetch: () => undefined }),
}));

const { DiceRoller } = await import('@/components/DiceRoller');
const { rollTime } = await import('@/components/RollLog');
const { NotificationsProvider } = await import('@/components/notifications/NotificationsProvider');
const { translator } = await import('@/messages');
type Language = import('@/messages').Language;
type RollPage = import('@/client/rolls').RollPage;
type StoredRoll = import('@/client/rolls').StoredRoll;
type DiceRollerLabels = import('@/components/DiceRoller').DiceRollerLabels;

const CAMPAIGN = '0190a0b0-0000-7000-8000-000000000002';
const SHIELD = '0190a0b0-0000-7000-8000-000000000a01';
const ROLLS = `/api/v1/campaigns/${CAMPAIGN}/shields/${SHIELD}/rolls`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const EMPTY: RollPage = { items: [], total: 0 };

const LABEL_KEYS = [
  'title', 'formula', 'roll', 'invalid', 'sentence', 'die', 'label', 'log', 'empty', 'unsaved', 'failed', 'remove', 'more',
  'moreFailed', 'loadFailed', 'clear', 'clearTitle', 'clearConsequence', 'clearConfirm', 'cleared', 'clearFailed', 'rollsOne',
  'rollsOther',
] as const;

function labelsFor(language: Language): DiceRollerLabels {
  const t = translator(language);
  return Object.fromEntries(LABEL_KEYS.map((key) => [key, t(`shields.dice.${key}`)])) as DiceRollerLabels;
}

type Fetched = { readonly url: string; readonly init: RequestInit | undefined };
let fetched: Fetched[] = [];
/** How the relay answers each request; the default stores each roll sent (201). */
let relay: (url: string, init: RequestInit | undefined) => Promise<Response> = defaultRelay;

function stored(body: Record<string, unknown>, id = '0190a0b0-0000-7000-8000-00000000f001'): StoredRoll {
  const results = body.results as number[];
  return {
    id,
    key: body.key as string,
    formula: body.formula as string,
    results,
    total: results.reduce((sum, face) => sum + face, 0),
    label: (body.label as string | undefined) ?? null,
    rolledAt: body.rolledAt as string,
  };
}

async function defaultRelay(url: string, init: RequestInit | undefined): Promise<Response> {
  if (init?.method === 'POST') {
    return Response.json(stored(JSON.parse(String(init.body)) as Record<string, unknown>), { status: 201 });
  }
  if (init?.method === 'DELETE') {
    return new Response(null, { status: 204 });
  }
  return Response.json(EMPTY, { status: 200 });
}

function posted(): Record<string, unknown>[] {
  return fetched.filter((call) => call.init?.method === 'POST').map((call) => JSON.parse(String(call.init?.body)) as Record<string, unknown>);
}

function roller(labels: DiceRollerLabels, firstPage: RollPage | null = EMPTY, language: Language = 'pt-BR') {
  return <DiceRoller labels={labels} language={language} campaignId={CAMPAIGN} shieldId={SHIELD} firstPage={firstPage} />;
}

/** A stored roll of the first page: `minutesAgo` before now, its label, its one d20. */
function storedRoll(index: number, minutesAgo: number, label: string | null = null): StoredRoll {
  return {
    id: `0190a0b0-0000-7000-8000-${String(index).padStart(12, '0')}`,
    key: `3b241101-e2bb-4255-8caf-${String(index).padStart(12, '0')}`,
    formula: '1d20',
    results: [index % 20 + 1],
    total: index % 20 + 1,
    label,
    rolledAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
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

/** The log's lines, newest first. */
function lines(): HTMLElement[] {
  const log = within(screen.getByRole('region', { name: /^(Rolagens|Rolls)$/ })).queryByRole('list');
  return log === null ? [] : within(log).queryAllByRole('listitem');
}

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

beforeEach(() => {
  fetched = [];
  relay = defaultRelay;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      fetched.push({ url, init });
      return relay(url, init);
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the dice roller (Story 6.3)', () => {
  it('shows the die buttons d4 to d100 in order, then the "Fórmula" field and an outlined "Rolar", in both languages', () => {
    for (const language of ['pt-BR', 'en'] as const) {
      const labels = labelsFor(language);
      const { container, unmount } = render(roller(labels));

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
    const { container } = render(roller(labelsFor('pt-BR')));

    await user.click(screen.getByRole('button', { name: 'd20' }));

    expect(result(container)?.textContent).toBe('1d201717');
    expect(liveRegion(container).textContent).toBe('1d20: 17, total 17');
  });

  it('every die button stays within its range with the real source', async () => {
    const user = userEvent.setup();
    const { container } = render(roller(labelsFor('en')));
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
    const { container } = render(roller(labels));

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
    const { container } = render(roller(labels));

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
    const { container } = render(roller(labelsFor('pt-BR')));

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
      const { container, unmount } = render(roller(labels));
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
    render(roller(labels));
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
    const { container } = render(roller(labels));
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

  it('rolls offline as online: each roll shows at once, goes to the relay POST, and with no answer reads "could not be saved"; nothing is stored in the browser', async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    globalThis.dispatchEvent(new Event('offline'));
    relay = async () => {
      throw new TypeError('offline');
    };
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    scriptRandom([19, 2, 3]);
    const labels = labelsFor('en');
    const { container } = render(roller(labels, EMPTY, 'en'));

    expect(navigator.onLine).toBe(false);
    await user.click(screen.getByRole('button', { name: 'd20' }));
    expect(liveRegion(container).textContent).toBe('1d20: 20, total 20');
    await user.type(screen.getByRole('textbox', { name: labels.formula }), '2d6+3{Enter}');
    expect(liveRegion(container).textContent).toBe('2d6+3: 3, 4, total 10');

    // Each roll went to this site's relay, never to the backend, and none was confirmed.
    expect(fetched.map((call) => [call.url, call.init?.method])).toEqual([[ROLLS, 'POST'], [ROLLS, 'POST']]);
    expect(posted().map((body) => body.formula)).toEqual(['1d20', '2d6+3']);
    await screen.findAllByText(labels.failed);
    expect(lines().map((line) => line.textContent?.includes(labels.failed))).toEqual([true, true]);
    expect(setItem).not.toHaveBeenCalled();
  });

  it('never uses Math.random', async () => {
    const user = userEvent.setup();
    const random = vi.spyOn(Math, 'random');
    render(roller(labelsFor('pt-BR')));
    for (const name of ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100']) {
      await user.click(screen.getByRole('button', { name }));
    }
    expect(random).not.toHaveBeenCalled();
  });
});

describe('the roll log (Story 6.4 part A)', () => {
  it('lists the stored rolls newest first: each line its time, label, formula, dice and total, with no mark', () => {
    const page: RollPage = { items: [storedRoll(1, 1, 'Iniciativa'), storedRoll(2, 5)], total: 2 };
    const labels = labelsFor('pt-BR');
    render(roller(labels, page));

    expect(screen.getByRole('heading', { level: 3, name: labels.log })).toBeTruthy();
    const shown = lines();
    expect(shown).toHaveLength(2);
    const first = shown[0]!;
    expect(first.querySelector('time')?.getAttribute('dateTime')).toBe(page.items[0]!.rolledAt);
    expect(first.querySelector('time')?.textContent).toBe(rollTime(page.items[0]!.rolledAt, 'pt-BR'));
    expect(first.textContent).toContain('Iniciativa');
    expect(first.textContent).toContain('1d20');
    expect(first.textContent).toContain('2');
    expect(first.textContent).not.toContain(labels.unsaved);
    expect(first.textContent).not.toContain(labels.failed);
    expect(within(first).queryByRole('button')).toBeNull();
    expect(screen.queryByText(labels.empty)).toBeNull();
    expect(screen.getByRole('button', { name: labels.clear })).toBeTruthy();
  });

  it('an empty log reads "Nenhuma rolagem ainda." and offers no clear', () => {
    for (const language of ['pt-BR', 'en'] as const) {
      const labels = labelsFor(language);
      const { unmount } = render(roller(labels, EMPTY, language));
      expect(screen.getByText(labels.empty)).toBeTruthy();
      expect(screen.queryByRole('button', { name: labels.clear })).toBeNull();
      expect(screen.queryByRole('button', { name: labels.more })).toBeNull();
      unmount();
    }
    expect(labelsFor('pt-BR').empty).toBe('Nenhuma rolagem ainda.');
  });

  it('a roll shows in the log at once with its label and "ainda não salva", is posted with its own key, and the mark goes once it is saved', async () => {
    const user = userEvent.setup();
    scriptRandom([4, 3]);
    let answer: (response: Response) => void = () => undefined;
    relay = (url, init) => (init?.method === 'POST' ? new Promise<Response>((resolve) => (answer = resolve)) : defaultRelay(url, init));
    const labels = labelsFor('pt-BR');
    render(roller(labels));
    const labelField = screen.getByRole('textbox', { name: labels.label }) as HTMLInputElement;

    await user.type(labelField, '  Iniciativa ');
    await user.click(screen.getByRole('button', { name: 'd20' }));

    // At once, before any answer: the line, its label and its mark; the label field is empty again.
    expect(labelField.value).toBe('');
    const line = lines()[0]!;
    expect(line.textContent).toContain('Iniciativa');
    expect(line.textContent).toContain('1d20');
    expect(line.textContent).toContain(labels.unsaved);
    expect(labels.unsaved).toBe('ainda não salva');
    const [body] = posted();
    expect(body).toMatchObject({ formula: '1d20', results: [5], label: 'Iniciativa' });
    expect(String(body!.key)).toMatch(UUID);
    expect(Date.now() - Date.parse(String(body!.rolledAt))).toBeLessThan(60_000);
    expect(screen.queryByText(labels.empty)).toBeNull();

    await act(async () => answer(Response.json(stored(body!), { status: 201 })));
    expect(lines()[0]!.textContent).not.toContain(labels.unsaved);

    // The label was for that roll only: the next one, from the formula, has none; and each roll has its own key.
    relay = defaultRelay;
    await user.type(screen.getByRole('textbox', { name: labels.formula }), '1d4{Enter}');
    const second = posted()[1]!;
    expect(second.label).toBeUndefined();
    expect(second.key).not.toBe(body!.key);
    expect(lines()).toHaveLength(2);
    expect(lines()[0]!.textContent).toContain('1d4');
  });

  it('a refused roll, or one with no answer, reads "não foi possível salvar" with a remove control that has a spoken name', async () => {
    const user = userEvent.setup();
    scriptRandom([0]);
    const labels = labelsFor('pt-BR');
    relay = async (url, init) =>
      init?.method === 'POST'
        ? Response.json({ status: 400, category: 'request', code: 'request.roll_invalid', params: {} }, { status: 400 })
        : defaultRelay(url, init);
    render(roller(labels));

    await user.click(screen.getByRole('button', { name: 'd6' }));
    await screen.findByText(labels.failed);
    const line = lines()[0]!;
    expect(line.textContent).toContain(labels.failed);
    expect(line.textContent).not.toContain(labels.unsaved);
    const time = line.querySelector('time')?.textContent ?? '';
    const remove = within(line).getByRole('button', { name: `Remover a rolagem 1d6 das ${time}` });

    // No answer at all reads the same.
    relay = async () => {
      throw new TypeError('offline');
    };
    await user.click(screen.getByRole('button', { name: 'd8' }));
    await vi.waitFor(() => expect(screen.getAllByText(labels.failed)).toHaveLength(2));

    await user.click(remove);
    expect(lines()).toHaveLength(1);
    expect(lines()[0]!.textContent).toContain('1d8');
    await user.click(within(lines()[0]!).getByRole('button'));
    expect(screen.getByText(labels.empty)).toBeTruthy();
  });

  it('shows the newest 10, and "Mostrar mais" reads 10 more after the cursor', async () => {
    const user = userEvent.setup();
    const items = Array.from({ length: 10 }, (_, index) => storedRoll(index + 1, index + 1));
    const older = Array.from({ length: 3 }, (_, index) => storedRoll(index + 11, index + 11));
    relay = async (url, init) =>
      init?.method === undefined ? Response.json({ items: older, total: 13 }, { status: 200 }) : defaultRelay(url, init);
    const labels = labelsFor('pt-BR');
    render(roller(labels, { items, nextCursor: items[9]!.id, total: 13 }));
    expect(lines()).toHaveLength(10);

    await user.click(screen.getByRole('button', { name: labels.more }));

    await vi.waitFor(() => expect(lines()).toHaveLength(13));
    expect(fetched.map((call) => call.url)).toEqual([`${ROLLS}?limit=10&cursor=${items[9]!.id}`]);
    expect(lines()[12]!.querySelector('time')?.getAttribute('dateTime')).toBe(older[2]!.rolledAt);
    expect(screen.queryByRole('button', { name: labels.more })).toBeNull();
  });

  it('a new roll pushes the tenth one below "Mostrar mais", which then shows it without a request', async () => {
    const user = userEvent.setup();
    scriptRandom([1]);
    const items = Array.from({ length: 10 }, (_, index) => storedRoll(index + 1, index + 1));
    const labels = labelsFor('en');
    render(roller(labels, { items, total: 10 }, 'en'));
    expect(screen.queryByRole('button', { name: labels.more })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'd4' }));
    expect(lines()).toHaveLength(10);
    await user.click(screen.getByRole('button', { name: labels.more }));

    expect(lines()).toHaveLength(11);
    expect(fetched.filter((call) => call.init?.method === undefined)).toHaveLength(0);
  });

  it('"Limpar rolagens" opens the dialog naming the count; confirming clears the log and says so in a toast', async () => {
    const user = userEvent.setup();
    const labels = labelsFor('pt-BR');
    const page: RollPage = { items: [storedRoll(1, 1), storedRoll(2, 2), storedRoll(3, 3)], total: 3 };
    render(<NotificationsProvider language="pt-BR">{roller(labels, page)}</NotificationsProvider>);

    await user.click(screen.getByRole('button', { name: labels.clear }));
    const dialog = screen.getByRole('dialog', { name: 'Limpar 3 rolagens?' });
    expect(dialog.textContent).toContain(labels.clearConsequence);
    await user.click(within(dialog).getByRole('button', { name: labels.clearConfirm }));

    await screen.findByText(labels.empty);
    expect(fetched.map((call) => [call.url, call.init?.method])).toEqual([[ROLLS, 'DELETE']]);
    expect(lines()).toHaveLength(0);
    expect(screen.queryByRole('button', { name: labels.clear })).toBeNull();
    expect(within(screen.getByRole('region', { name: 'Avisos' })).getByText(labels.cleared)).toBeTruthy();
  });

  it('the dialog counts one roll in the singular, cancel keeps the log, and a refused clear keeps it with a toast', async () => {
    const user = userEvent.setup();
    const labels = labelsFor('en');
    relay = async (url, init) =>
      init?.method === 'DELETE' ? Response.json({ status: 503, category: 'server', code: 'server.unavailable', params: {} }, { status: 503 }) : defaultRelay(url, init);
    render(<NotificationsProvider language="en">{roller(labels, { items: [storedRoll(1, 1)], total: 1 }, 'en')}</NotificationsProvider>);

    await user.click(screen.getByRole('button', { name: labels.clear }));
    await user.click(within(screen.getByRole('dialog', { name: 'Clear 1 roll?' })).getByRole('button', { name: 'Cancel' }));
    expect(fetched).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: labels.clear }));
    await user.click(within(screen.getByRole('dialog', { name: 'Clear 1 roll?' })).getByRole('button', { name: labels.clearConfirm }));

    await screen.findByText(labels.clearFailed);
    expect(lines()).toHaveLength(1);
  });

  it('when the stored rolls could not be read, the log says so, the roller still works and nothing can be cleared', async () => {
    const user = userEvent.setup();
    scriptRandom([2]);
    const labels = labelsFor('pt-BR');
    render(roller(labels, null));

    expect(screen.getByText(labels.loadFailed)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'd12' }));
    expect(lines()).toHaveLength(1);
    expect(posted()).toHaveLength(1);
    expect(screen.queryByRole('button', { name: labels.clear })).toBeNull();
  });

  it('"Limpar rolagens" opens nothing while a roll is still being sent, and opens once it is answered', async () => {
    const user = userEvent.setup();
    scriptRandom([1]);
    let answer: (response: Response) => void = () => undefined;
    relay = (url, init) => (init?.method === 'POST' ? new Promise<Response>((resolve) => (answer = resolve)) : defaultRelay(url, init));
    const labels = labelsFor('pt-BR');
    render(roller(labels, { items: [storedRoll(1, 1)], total: 1 }));

    await user.click(screen.getByRole('button', { name: 'd6' }));
    const clear = screen.getByRole('button', { name: labels.clear });
    expect(clear.getAttribute('aria-disabled')).toBe('true');
    await user.click(clear);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(fetched.filter((call) => call.init?.method === 'DELETE')).toHaveLength(0);

    await act(async () => answer(Response.json(stored(posted()[0]!), { status: 201 })));
    expect(clear.getAttribute('aria-disabled')).toBeNull();
    await user.click(clear);
    expect(screen.getByRole('dialog', { name: 'Limpar 2 rolagens?' })).toBeTruthy();
  });

  it('a roll stored now counts in the clear; one already held (200) does not', async () => {
    const user = userEvent.setup();
    scriptRandom([1]);
    const labels = labelsFor('pt-BR');
    const { unmount } = render(roller(labels, EMPTY));
    expect(screen.queryByRole('button', { name: labels.clear })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'd4' }));
    await vi.waitFor(() => expect(lines()[0]!.textContent).not.toContain(labels.unsaved));
    await user.click(screen.getByRole('button', { name: labels.clear }));
    expect(screen.getByRole('dialog', { name: 'Limpar 1 rolagem?' })).toBeTruthy();
    unmount();

    const three: RollPage = { items: [storedRoll(1, 1), storedRoll(2, 2), storedRoll(3, 3)], total: 3 };
    const second = render(roller(labels, three));
    await user.click(screen.getByRole('button', { name: 'd4' }));
    await vi.waitFor(() => expect(lines()[0]!.textContent).not.toContain(labels.unsaved));
    await user.click(screen.getByRole('button', { name: labels.clear }));
    expect(screen.getByRole('dialog', { name: 'Limpar 4 rolagens?' })).toBeTruthy();
    second.unmount();

    relay = async (url, init) =>
      init?.method === 'POST' ? Response.json(stored(JSON.parse(String(init.body)) as Record<string, unknown>), { status: 200 }) : defaultRelay(url, init);
    render(roller(labels, three));
    await user.click(screen.getByRole('button', { name: 'd4' }));
    await vi.waitFor(() => expect(lines()[0]!.textContent).not.toContain(labels.unsaved));
    await user.click(screen.getByRole('button', { name: labels.clear }));
    expect(screen.getByRole('dialog', { name: 'Limpar 3 rolagens?' })).toBeTruthy();
  });

  it('"Mostrar mais" merges the next page once per key, newest first, with this visit\'s rolls', async () => {
    const user = userEvent.setup();
    scriptRandom([1]);
    const items = Array.from({ length: 10 }, (_, index) => storedRoll(index + 1, (index + 1) * 10));
    const labels = labelsFor('pt-BR');
    render(roller(labels, { items, nextCursor: items[9]!.id, total: 13 }));
    await user.click(screen.getByRole('button', { name: 'd8' }));
    await vi.waitFor(() => expect(lines()[0]!.textContent).not.toContain(labels.unsaved));
    const mine = stored(posted()[0]!, '0190a0b0-0000-7000-8000-00000000f0f0');
    // The next page holds this visit's roll again, and a roll newer than some already shown (another device's).
    const newer = storedRoll(50, 35);
    const older = storedRoll(51, 500);
    relay = async (url, init) => (init?.method === undefined ? Response.json({ items: [mine, newer, older], total: 13 }) : defaultRelay(url, init));

    await user.click(screen.getByRole('button', { name: labels.more }));

    await vi.waitFor(() => expect(lines()).toHaveLength(13));
    const times = lines().map((line) => line.querySelector('time')?.getAttribute('dateTime') ?? '');
    expect(times).toEqual([...times].sort((a, b) => Date.parse(b) - Date.parse(a)));
    expect(lines().filter((line) => line.querySelector('time')?.getAttribute('dateTime') === mine.rolledAt)).toHaveLength(1);
    expect(times.indexOf(newer.rolledAt)).toBe(4);
    expect(times.at(-1)).toBe(older.rolledAt);
  });

  it('keeps "could not be read" from its start, whatever page the notes show next', () => {
    const labels = labelsFor('pt-BR');
    const { rerender } = render(roller(labels, null));
    rerender(roller(labels, { items: [storedRoll(1, 1)], total: 1 }));
    expect(screen.getByText(labels.loadFailed)).toBeTruthy();
    expect(screen.queryByRole('button', { name: labels.clear })).toBeNull();
  });

  it('the time is hour:minute, with the day and month when the roll is not from today', () => {
    const now = new Date(2026, 10, 27, 15, 30);
    expect(rollTime(new Date(2026, 10, 27, 9, 5).toISOString(), 'pt-BR', now)).toBe('09:05');
    expect(rollTime(new Date(2026, 10, 25, 21, 7).toISOString(), 'pt-BR', now)).toBe('25/11, 21:07');
    expect(rollTime(new Date(2026, 10, 25, 21, 7).toISOString(), 'en', now)).toMatch(/^11\/25, 0?9:07\sPM$/);
  });

  it('the remove control is a 44px square, and a line wraps rather than scrolling sideways', () => {
    const css = readFileSync(join(process.cwd(), 'src/components/RollLog.module.css'), 'utf8');
    expect(css).toMatch(/\.remove \{[^}]*width: var\(--space-touch-target\);[^}]*height: var\(--space-touch-target\);/);
    expect(css).toMatch(/\.line \{[^}]*grid-template-columns: auto minmax\(0, 1fr\) auto;[^}]*min-width: 0;/);
    expect(css).toMatch(/\.what \{[^}]*flex-wrap: wrap;[^}]*min-width: 0;/);
  });
});
