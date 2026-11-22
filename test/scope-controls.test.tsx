import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Scope } from '@/components/scope';
import { scopeSummary } from '@/components/scope';
import { MATERIALS_PER_PAGE, ScopeControls, type ScopeFormState } from '@/components/ScopeControls';
import { ScopePopover } from '@/components/ScopePopover';
import { Switch } from '@/components/Switch';
import { translator } from '@/messages';

const ptBR = (await import('@/messages/pt-BR.json')).default;
const en = (await import('@/messages/en.json')).default;

const CAMPAIGN = '0190a0b0-0000-7000-8000-000000000002';
const NOTES = '0190a0b0-0000-7000-8000-000000000052';
const BOOK = '0190a0b0-0000-7000-8000-000000000003';
const BESTIARY = '0190a0b0-0000-7000-8000-000000000051';
const ATLAS = '0190a0b0-0000-7000-8000-000000000057';
const SCOPE: Scope = {
  version: 4,
  campaignTier: true,
  systemTier: true,
  otherTier: false,
  modelKnowledge: false,
  materials: [
    { id: NOTES, name: 'Notas da sessão 12.md', tier: 'campaign', on: true },
    { id: BOOK, name: 'Livro do Jogador.pdf', tier: 'system', on: true },
    { id: BESTIARY, name: 'Bestiário.pdf', tier: 'system', on: false },
    { id: ATLAS, name: 'Atlas de outra mesa.pdf', tier: 'other', on: true },
  ],
};
const T = ptBR.campaigns.scope;
const SAVED = ptBR.material.belonging.saved;

type Action = (previous: ScopeFormState, form: FormData) => Promise<ScopeFormState>;

/**
 * The answers still held when a test ends. React entangles every async action of a transition, so one left pending
 * would keep the next test's saves pending too: each is answered (as it was) after the test.
 */
let held: (() => void)[] = [];

afterEach(async () => {
  await act(async () => {
    for (const release of held) {
      release();
    }
  });
  held = [];
  cleanup();
});

/** An action whose answer the test gives when it chooses, with each form it was posted. */
function heldAction() {
  const forms: FormData[] = [];
  let release: (answer: (previous: ScopeFormState) => ScopeFormState) => void = () => undefined;
  const action = vi.fn<Action>(
    (previous, form) =>
      new Promise((resolve) => {
        forms.push(form);
        release = (answer) => resolve(answer(previous));
        held.push(() => resolve(previous));
      }),
  );
  return { action, forms, answer: (answer: (previous: ScopeFormState) => ScopeFormState) => act(async () => release(answer)) };
}

function saved(scope: Scope) {
  return (): ScopeFormState => ({ scope, error: null, saved: true });
}

const switchState = (name: string) => screen.getByRole('switch', { name }).getAttribute('aria-checked');
const switchNames = () => screen.queryAllByRole('switch').map((element) => element.getAttribute('aria-label'));

describe('a switch (Story 3.6)', () => {
  it('is a switch with its name, its state spoken in words, and a press that turns it', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(<Switch label="Campanha" checked={false} states={{ on: 'ligado', off: 'desligado' }} onChange={onChange} />);
    const element = screen.getByRole('switch', { name: 'Campanha' });
    expect(element.getAttribute('aria-checked')).toBe('false');
    // A screen reader hears its name, then "desligado" (its description), shown beside the track too.
    expect(element.getAttribute('aria-describedby')).toBeTruthy();
    expect(document.getElementById(element.getAttribute('aria-describedby')!)?.textContent).toBe('desligado');
    await user.click(element);
    expect(onChange).toHaveBeenCalledWith(true);
    rerender(<Switch label="Campanha" checked states={{ on: 'ligado', off: 'desligado' }} onChange={onChange} />);
    expect(element.getAttribute('aria-checked')).toBe('true');
    expect(within(element).getByText('ligado')).toBeTruthy();
    // Its name does not change with its state.
    expect(screen.getByRole('switch', { name: 'Campanha' })).toBe(element);
  });

  it('disabled, it keeps its focus, says so and ignores a press; a reason is read after its state', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <>
        <Switch label="Conhecimento do modelo" checked={false} states={{ on: 'ligado', off: 'desligado' }} onChange={onChange} disabled describedBy="why" />
        <p id="why">Indisponível agora</p>
      </>,
    );
    const element = screen.getByRole('switch', { name: 'Conhecimento do modelo' });
    expect(element.getAttribute('aria-disabled')).toBe('true');
    expect(element.hasAttribute('disabled')).toBe(false);
    const [state, why] = element.getAttribute('aria-describedby')!.split(' ');
    expect(document.getElementById(state!)?.textContent).toBe('desligado');
    expect(why).toBe('why');
    await user.click(element);
    expect(onChange).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(element);
  });
});

describe('the scope controls (Story 3.6)', () => {
  it('matrix row "Default": tier switches, the materials of each tier that is on under it, and the model-knowledge switch, enabled (Story 3.8)', () => {
    render(<ScopeControls campaignId={CAMPAIGN} scope={SCOPE} language="pt-BR" action={vi.fn<Action>()} />);
    expect(switchNames()).toEqual([T.campaign, 'Notas da sessão 12.md', T.system, 'Livro do Jogador.pdf', 'Bestiário.pdf', T.other, T.modelKnowledge]);
    expect(switchState(T.campaign)).toBe('true');
    expect(switchState(T.system)).toBe('true');
    expect(switchState(T.other)).toBe('false');
    expect(switchState('Livro do Jogador.pdf')).toBe('true');
    expect(switchState('Bestiário.pdf')).toBe('false');
    // An off tier lists none of its materials.
    expect(screen.queryByText('Atlas de outra mesa.pdf')).toBeNull();
    expect(within(screen.getByRole('list', { name: 'Materiais: Sistema' })).getAllByRole('switch')).toHaveLength(2);
    const model = screen.getByRole('switch', { name: T.modelKnowledge });
    expect(model.getAttribute('aria-disabled')).toBeNull();
    // Its state is read after its name; no "coming soon" note any more.
    expect(model.getAttribute('aria-describedby')?.split(' ').map((id) => document.getElementById(id)?.textContent)).toEqual(['desligado']);
    expect(screen.queryByText('Chega em breve')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('matrix row "Material off": a press posts the whole settings; the switch turns at once, all wait, then one line says when it applies', async () => {
    const user = userEvent.setup();
    const { action, forms, answer } = heldAction();
    const { container } = render(<ScopeControls campaignId={CAMPAIGN} scope={SCOPE} language="pt-BR" action={action} />);
    await user.click(screen.getByRole('switch', { name: 'Livro do Jogador.pdf' }));
    expect(action).toHaveBeenCalledTimes(1);
    const form = forms[0]!;
    expect(Object.fromEntries([...form.entries()].filter(([key]) => key !== 'materialsOff'))).toEqual({
      campaign: CAMPAIGN,
      version: '4',
      campaignTier: 'true',
      systemTier: 'true',
      otherTier: 'false',
      modelKnowledge: 'false',
    });
    expect(form.getAll('materialsOff')).toEqual([BOOK, BESTIARY]);
    // While it is saved: the switch shows its new state, the tier stays on, and every switch waits.
    expect(switchState('Livro do Jogador.pdf')).toBe('false');
    expect(switchState(T.system)).toBe('true');
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    for (const element of screen.getAllByRole('switch')) {
      expect(element.getAttribute('aria-disabled')).toBe('true');
    }
    await user.click(screen.getByRole('switch', { name: 'Notas da sessão 12.md' }));
    expect(action).toHaveBeenCalledTimes(1);

    const stored = { ...SCOPE, version: 5, materials: SCOPE.materials.map((m) => (m.id === BOOK ? { ...m, on: false } : m)) };
    await answer(saved(stored));
    expect(switchState('Livro do Jogador.pdf')).toBe('false');
    expect(screen.getByRole('status').textContent).toBe(SAVED);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
    expect(screen.getByRole('switch', { name: T.campaign }).getAttribute('aria-disabled')).toBeNull();
    // The next press names the version the save answered.
    await user.click(screen.getByRole('switch', { name: T.other }));
    expect(forms[1]!.get('version')).toBe('5');
    expect(forms[1]!.get('otherTier')).toBe('true');
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('matrix row "Tier off": its materials go from the list once it is off', async () => {
    const user = userEvent.setup();
    const { action, forms, answer } = heldAction();
    render(<ScopeControls campaignId={CAMPAIGN} scope={SCOPE} language="pt-BR" action={action} />);
    await user.click(screen.getByRole('switch', { name: T.system }));
    expect(forms[0]!.get('systemTier')).toBe('false');
    // The materials off stay as stored, whatever their tier.
    expect(forms[0]!.getAll('materialsOff')).toEqual([BESTIARY]);
    await answer(saved({ ...SCOPE, version: 5, systemTier: false }));
    expect(switchNames()).toEqual([T.campaign, 'Notas da sessão 12.md', T.system, T.other, T.modelKnowledge]);
    expect(screen.queryByRole('list', { name: 'Materiais: Sistema' })).toBeNull();
  });

  it('matrix row "Stale": the switches show the settings as they are now, with a danger line', async () => {
    const user = userEvent.setup();
    const { action, answer } = heldAction();
    render(<ScopeControls campaignId={CAMPAIGN} scope={SCOPE} language="pt-BR" action={action} />);
    await user.click(screen.getByRole('switch', { name: 'Livro do Jogador.pdf' }));
    const now = { ...SCOPE, version: 7, otherTier: true };
    await answer(() => ({ scope: now, error: T.stale, saved: false }));
    expect(screen.getByRole('alert').textContent).toBe(T.stale);
    expect(switchState('Livro do Jogador.pdf')).toBe('true');
    expect(switchState(T.other)).toBe('true');
    expect(screen.getByText('Atlas de outra mesa.pdf')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('matrix row "Refused": the switches go back to what is stored, and the reason shows beside them', async () => {
    const user = userEvent.setup();
    const { action, answer } = heldAction();
    render(<ScopeControls campaignId={CAMPAIGN} scope={SCOPE} language="pt-BR" action={action} />);
    await user.click(screen.getByRole('switch', { name: 'Livro do Jogador.pdf' }));
    expect(switchState('Livro do Jogador.pdf')).toBe('false');
    const text = ptBR.errors.codes.scope.material_unknown;
    await answer((previous) => ({ ...previous, error: text, saved: false }));
    expect(switchState('Livro do Jogador.pdf')).toBe('true');
    expect(screen.getByRole('alert').textContent).toBe(text);
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('matrix row "Switch" (Story 3.8): the model-knowledge switch saves the whole settings with it turned, and says when it applies', async () => {
    const user = userEvent.setup();
    const { action, forms, answer } = heldAction();
    render(<ScopeControls campaignId={CAMPAIGN} scope={SCOPE} language="pt-BR" action={action} />);
    const model = screen.getByRole('switch', { name: T.modelKnowledge });
    expect(model.getAttribute('aria-checked')).toBe('false');
    await user.click(model);
    expect(action).toHaveBeenCalledTimes(1);
    expect(Object.fromEntries([...forms[0]!.entries()].filter(([key]) => key !== 'materialsOff'))).toEqual({
      campaign: CAMPAIGN,
      version: '4',
      campaignTier: 'true',
      systemTier: 'true',
      otherTier: 'false',
      modelKnowledge: 'true',
    });
    // It turns at once while it is saved, and waits like every switch.
    expect(switchState(T.modelKnowledge)).toBe('true');
    expect(screen.getByRole('switch', { name: T.modelKnowledge }).getAttribute('aria-disabled')).toBe('true');
    await answer(saved({ ...SCOPE, version: 5, modelKnowledge: true }));
    expect(switchState(T.modelKnowledge)).toBe('true');
    expect(screen.getByRole('status').textContent).toBe(SAVED);
    // The stored value goes with any other press.
    await user.click(screen.getByRole('switch', { name: T.other }));
    expect(forms[1]!.get('modelKnowledge')).toBe('true');
    expect(forms[1]!.get('version')).toBe('5');
  });

  it('the model-knowledge switch, stored on, turns off with a press (en)', async () => {
    const user = userEvent.setup();
    const { action, forms } = heldAction();
    render(<ScopeControls campaignId={CAMPAIGN} scope={{ ...SCOPE, modelKnowledge: true }} language="en" action={action} />);
    const model = screen.getByRole('switch', { name: en.campaigns.scope.modelKnowledge });
    expect(model.getAttribute('aria-checked')).toBe('true');
    await user.click(model);
    expect(forms[0]!.get('modelKnowledge')).toBe('false');
  });

  it('pages a tier\'s materials ten at a time with a compact pager that turns pages here, newest first as listed', async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 23 }, (_, i) => ({
      id: `0190a0b0-0000-7000-8000-${String(100 + i).padStart(12, '0')}`,
      name: `Livro ${i + 1}.pdf`,
      tier: 'system' as const,
      on: true,
    }));
    render(<ScopeControls campaignId={CAMPAIGN} scope={{ ...SCOPE, materials: many }} language="pt-BR" action={vi.fn<Action>()} />);
    expect(MATERIALS_PER_PAGE).toBe(10);
    const list = () => within(screen.getByRole('list', { name: 'Materiais: Sistema' })).getAllByRole('switch').map((e) => e.getAttribute('aria-label'));
    expect(list()).toEqual(many.slice(0, 10).map((m) => m.name));
    // The campaign tier, on and empty, says so in one line.
    expect(screen.getByText(T.noMaterials)).toBeTruthy();
    const pager = screen.getByRole('navigation', { name: 'Páginas dos materiais: Sistema' });
    expect(within(pager).queryAllByRole('link')).toEqual([]);
    expect(screen.getByText('1–10 de 23')).toBeTruthy();
    await user.click(within(pager).getByRole('button', { name: 'Próxima' }));
    expect(list()).toEqual(many.slice(10, 20).map((m) => m.name));
    const next = within(pager).getByRole('button', { name: 'Próxima' });
    await user.click(next);
    expect(list()).toEqual(many.slice(20).map((m) => m.name));
    expect(screen.getByText('21–23 de 23')).toBeTruthy();
    // On the last page "Próxima" leads nowhere, but stays the same button with the focus the press gave it.
    const last = within(pager).getByRole('button', { name: 'Próxima' });
    expect(last).toBe(next);
    expect(last.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(last);
    await user.click(last);
    expect(list()).toEqual(many.slice(20).map((m) => m.name));
    await user.click(within(pager).getByRole('button', { name: 'Anterior' }));
    expect(list()).toEqual(many.slice(10, 20).map((m) => m.name));
  });

  it('prefers settings the page read since its last answer: a newer `scope` shows, and the next press names its version', async () => {
    const user = userEvent.setup();
    const { action, forms, answer } = heldAction();
    const { rerender } = render(<ScopeControls campaignId={CAMPAIGN} scope={SCOPE} language="pt-BR" action={action} />);
    await user.click(screen.getByRole('switch', { name: 'Livro do Jogador.pdf' }));
    await answer(saved({ ...SCOPE, version: 5 }));
    rerender(<ScopeControls campaignId={CAMPAIGN} scope={{ ...SCOPE, version: 6, otherTier: true }} language="pt-BR" action={action} />);
    expect(switchState(T.other)).toBe('true');
    await user.click(screen.getByRole('switch', { name: 'Notas da sessão 12.md' }));
    expect(forms[1]!.get('version')).toBe('6');
  });
});

describe('the scope summary and its popover (Story 3.6)', () => {
  it('names the tiers that are on, or no sources, then model knowledge, in both languages', () => {
    const pt = translator('pt-BR');
    const english = translator('en');
    expect(scopeSummary(SCOPE, pt)).toBe('Campanha + Sistema · conhecimento do modelo desligado');
    expect(scopeSummary(SCOPE, english)).toBe('Campaign + System · model knowledge off');
    expect(scopeSummary({ ...SCOPE, systemTier: false }, pt)).toBe('Campanha · conhecimento do modelo desligado');
    expect(scopeSummary({ ...SCOPE, campaignTier: false, systemTier: false }, pt)).toBe('Nenhuma fonte · conhecimento do modelo desligado');
    expect(scopeSummary({ ...SCOPE, campaignTier: false, systemTier: false }, english)).toBe('No sources · model knowledge off');
    expect(scopeSummary({ ...SCOPE, otherTier: true, modelKnowledge: true }, pt)).toBe('Campanha + Sistema + Outros · conhecimento do modelo ligado');
  });

  function popover(action: Action = vi.fn<Action>()) {
    return render(
      <>
        <p>fora</p>
        <ScopePopover
          summary={scopeSummary(SCOPE, translator('pt-BR'))}
          label={ptBR.shell.scope.label}
          panel={ptBR.shell.scope.panel}
          campaignId={CAMPAIGN}
          scope={SCOPE}
          language="pt-BR"
          action={action}
        />
      </>,
    );
  }

  it('the summary opens the controls in a group; Esc closes it and gives focus back to the summary', async () => {
    const user = userEvent.setup();
    popover();
    const summary = screen.getByRole('button', { name: 'Escopo: Campanha + Sistema · conhecimento do modelo desligado' });
    expect(summary.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryAllByRole('switch')).toEqual([]);
    await user.click(summary);
    expect(summary.getAttribute('aria-expanded')).toBe('true');
    const group = screen.getByRole('group', { name: ptBR.shell.scope.panel });
    expect(summary.getAttribute('aria-controls')).toBe(group.id);
    expect(within(group).getAllByRole('switch')).toHaveLength(7);
    within(group).getByRole('switch', { name: T.campaign }).focus();
    await user.keyboard('{Escape}');
    expect(summary.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(summary);
    expect(screen.queryAllByRole('switch')).toEqual([]);
  });

  it('a press outside closes it; a press inside keeps it open', async () => {
    const user = userEvent.setup();
    const { action } = heldAction();
    popover(action);
    const summary = screen.getByRole('button', { name: /Campanha \+ Sistema/ });
    await user.click(summary);
    await user.click(screen.getByRole('switch', { name: 'Notas da sessão 12.md' }));
    expect(action).toHaveBeenCalledTimes(1);
    expect(summary.getAttribute('aria-expanded')).toBe('true');
    fireEvent.pointerDown(screen.getByText('fora'));
    expect(summary.getAttribute('aria-expanded')).toBe('false');
  });

  it('closed while a save runs, it shows that save\'s refusal once opened again', async () => {
    const user = userEvent.setup();
    const { action, answer } = heldAction();
    popover(action);
    const summary = screen.getByRole('button', { name: /Campanha \+ Sistema/ });
    await user.click(summary);
    await user.click(screen.getByRole('switch', { name: 'Livro do Jogador.pdf' }));
    await user.keyboard('{Escape}');
    expect(summary.getAttribute('aria-expanded')).toBe('false');
    const text = ptBR.errors.codes.scope.material_unknown;
    await answer((previous) => ({ ...previous, error: text, saved: false }));
    await user.click(summary);
    const group = screen.getByRole('group', { name: ptBR.shell.scope.panel });
    expect(within(group).getByRole('alert').textContent).toBe(text);
    expect(within(group).getByRole('switch', { name: 'Livro do Jogador.pdf' }).getAttribute('aria-checked')).toBe('true');
  });
});
