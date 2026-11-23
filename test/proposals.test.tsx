import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const routerRefresh = vi.fn();
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ refresh: () => routerRefresh(), push: () => undefined, replace: () => undefined, prefetch: () => undefined }),
}));

const { ProposalList } = await import('@/components/ProposalList');
type ProposalDecisionState = import('@/components/ProposalList').ProposalDecisionState;
const { proposalItem, termRow } = await import('@/app/(signed-in)/systems/rows');
const { translator } = await import('@/messages');
const ptBR = (await import('@/messages/pt-BR.json')).default;

const PROPOSAL = '0190a0b0-0000-7000-8000-000000000800';
const TERM_PROPOSAL = '0190a0b0-0000-7000-8000-000000000801';
const TERM = '0190a0b0-0000-7000-8000-000000000811';
const SPELL = '0190a0b0-0000-7000-8000-000000000601';
const MATERIAL = '0190a0b0-0000-7000-8000-000000000004';
const SYSTEM = '0190a0b0-0000-7000-8000-000000000001';

const TALENT = {
  id: PROPOSAL,
  systemId: SYSTEM,
  materialId: MATERIAL,
  materialName: 'Guia do Mestre.pdf',
  kind: 'record_type' as const,
  name: 'Talento',
  definition: null,
  examples: [
    { page: 40, quote: 'Talentos são habilidades especiais' },
    { page: 42, quote: 'Cada talento tem um pré-requisito' },
  ],
  state: 'pending' as const,
  version: 0,
};
const HIT_POINTS = {
  ...TALENT,
  id: TERM_PROPOSAL,
  kind: 'term' as const,
  name: 'PV',
  definition: 'Pontos de Vida (PV) medem a saúde do personagem.',
  examples: [{ page: 12, quote: 'Pontos de Vida (PV)' }],
};
const TARGETS = { record_type: [{ id: SPELL, label: 'Magia' }], term: [{ id: TERM, label: 'Pontos de Vida' }] };
const TEXTS = { ...ptBR.systems.proposals, noTargets: ptBR.systems.proposals.noTerms };

beforeEach(() => {
  routerRefresh.mockClear();
});

afterEach(() => cleanup());

describe('the proposal rows (Story 4.4)', () => {
  const t = translator('pt-BR');

  function list(action: (previous: ProposalDecisionState, form: FormData) => Promise<ProposalDecisionState>) {
    return render(
      <ProposalList
        label="Propostas de ontologia deste sistema"
        items={[proposalItem(TALENT, t, TARGETS), proposalItem(HIT_POINTS, t, TARGETS)]}
        texts={TEXTS}
        action={action}
        language="pt-BR"
      />,
    );
  }

  it('shows each name, kind, origin, definition and examples with their pages', () => {
    list(vi.fn());
    const rows = within(screen.getByRole('list', { name: 'Propostas de ontologia deste sistema' })).getAllByRole('listitem');
    const talent = rows.find((row) => row.textContent?.startsWith('Talento'))!;
    expect(talent.textContent).toContain('Tipo de registro');
    expect(talent.textContent).toContain('De Guia do Mestre.pdf');
    expect(within(talent).getByRole('list', { name: 'Exemplos do material' }).textContent).toBe(
      '«Talentos são habilidades especiais», p. 40«Cada talento tem um pré-requisito», p. 42',
    );
    const hp = rows.find((row) => row.textContent?.startsWith('PV'))!;
    expect(hp.textContent).toContain('Termo');
    expect(hp.textContent).toContain('Definição: Pontos de Vida (PV) medem a saúde do personagem.');
    // A material that is gone, and a material in several systems.
    expect(proposalItem({ ...TALENT, materialId: null, materialName: null }, t, TARGETS).detail).toBe('De material removido');
    expect(proposalItem(TALENT, t, TARGETS, 'Pathfinder').detail).toBe('De Guia do Mestre.pdf, em Pathfinder');
  });

  it('every decision works from the keyboard alone: approve, rename and approve, merge, reject', async () => {
    const user = userEvent.setup();
    const sent: Record<string, string>[] = [];
    const action = vi.fn(async (previous: ProposalDecisionState, data: FormData): Promise<ProposalDecisionState> => {
      sent.push(Object.fromEntries([...data.entries()].map(([key, value]) => [key, String(value)])));
      return { error: null, stale: false, serial: previous.serial + 1 };
    });
    list(action);
    const talent = screen.getByRole('group', { name: 'Decidir sobre «Talento»' });

    // Aprovar: Tab reaches it first, Enter presses it.
    await user.tab();
    expect(document.activeElement).toBe(within(talent).getByRole('button', { name: 'Aprovar' }));
    await user.keyboard('{Enter}');
    expect(sent.at(-1)).toEqual({ id: PROPOSAL, version: '0', decision: 'approve' });

    // Renomear: the field opens with the focus in it; Enter approves under the typed name.
    await user.tab();
    await user.keyboard('{Enter}');
    const field = screen.getByRole('textbox', { name: 'Novo nome para «Talento»' });
    expect(document.activeElement).toBe(field);
    await user.clear(field);
    await user.keyboard('Feat{Enter}');
    expect(sent.at(-1)).toEqual({ id: PROPOSAL, version: '0', decision: 'rename', name: 'Feat' });
    // "Cancelar" closes it and gives the focus back to "Renomear".
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(document.activeElement).toBe(within(screen.getByRole('group', { name: 'Decidir sobre «Talento»' })).getByRole('button', { name: 'Renomear' }));

    // Mesclar: a select of the system's types (for a type proposal), then "Mesclar".
    await user.tab();
    await user.keyboard('{Enter}');
    const select = screen.getByRole('combobox', { name: 'Mesclar «Talento» em' });
    expect(document.activeElement).toBe(select);
    expect(within(select).getAllByRole('option').map((option) => option.textContent)).toEqual(['Magia']);
    await user.tab();
    await user.keyboard('{Enter}');
    expect(sent.at(-1)).toEqual({ id: PROPOSAL, version: '0', decision: 'merge', target: SPELL });
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));

    // Rejeitar.
    await user.tab();
    await user.tab();
    expect(document.activeElement).toBe(within(screen.getByRole('group', { name: 'Decidir sobre «Talento»' })).getByRole('button', { name: 'Rejeitar' }));
    await user.keyboard('{Enter}');
    expect(sent.at(-1)).toEqual({ id: PROPOSAL, version: '0', decision: 'reject' });

    // A term proposal merges into the system's terms.
    await user.click(within(screen.getByRole('group', { name: 'Decidir sobre «PV»' })).getByRole('button', { name: 'Mesclar' }));
    expect(within(screen.getByRole('combobox', { name: 'Mesclar «PV» em' })).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Pontos de Vida',
    ]);
  });

  it('when a decided row leaves while its pill held the focus, the focus goes to the row now in its place', () => {
    const third = { ...TALENT, id: '0190a0b0-0000-7000-8000-000000000802', name: 'Antecedente' };
    const rows = [TALENT, HIT_POINTS, third].map((proposal) => proposalItem(proposal, t, TARGETS));
    const props = { label: 'Propostas', texts: TEXTS, action: vi.fn(), language: 'pt-BR' as const };
    const { rerender } = render(<ProposalList {...props} items={rows} />);
    within(screen.getByRole('group', { name: 'Decidir sobre «PV»' })).getByRole('button', { name: 'Rejeitar' }).focus();

    rerender(<ProposalList {...props} items={[rows[0]!, rows[2]!]} />);

    expect(document.activeElement).toBe(within(screen.getByRole('group', { name: 'Decidir sobre «Antecedente»' })).getByRole('button', { name: 'Aprovar' }));
    // The last row gone: the focus goes to the row that is last now.
    within(screen.getByRole('group', { name: 'Decidir sobre «Antecedente»' })).getByRole('button', { name: 'Aprovar' }).focus();
    rerender(<ProposalList {...props} items={[rows[0]!]} />);
    expect(document.activeElement).toBe(within(screen.getByRole('group', { name: 'Decidir sobre «Talento»' })).getByRole('button', { name: 'Aprovar' }));
  });

  it('a stale answer says the item changed in another tab and offers the current version; a refusal stays by the row', async () => {
    const user = userEvent.setup();
    list(async (previous) => ({ error: null, stale: true, serial: previous.serial + 1 }));
    await user.click(within(screen.getByRole('group', { name: 'Decidir sobre «Talento»' })).getByRole('button', { name: 'Aprovar' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Este item mudou em outra aba.');
    await user.click(within(alert).getByRole('button', { name: 'Ver a versão atual' }));
    expect(routerRefresh).toHaveBeenCalledOnce();

    cleanup();
    list(async (previous) => ({ error: 'O nome precisa ter de 1 a 120 caracteres.', stale: false, serial: previous.serial + 1 }));
    await user.click(within(screen.getByRole('group', { name: 'Decidir sobre «PV»' })).getByRole('button', { name: 'Rejeitar' }));
    expect((await screen.findByRole('alert')).textContent).toBe('O nome precisa ter de 1 a 120 caracteres.');
  });

  it('a term with no term to merge into says so, and an approved term reads with its definition, other names and origin', async () => {
    const user = userEvent.setup();
    render(
      <ProposalList
        label="Propostas"
        items={[proposalItem(HIT_POINTS, t, { record_type: [], term: [] })]}
        texts={TEXTS}
        action={vi.fn()}
        language="pt-BR"
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Mesclar' }));
    expect(screen.getByText('Este sistema ainda não tem termos para mesclar. Aprove um termo primeiro.')).toBeTruthy();
    expect((screen.getAllByRole('button', { name: 'Mesclar' }).at(-1) as HTMLButtonElement).disabled).toBe(true);

    const term = {
      id: TERM,
      name: 'Pontos de Vida',
      definition: 'medem a saúde',
      aliases: ['PV', 'HP'],
      origin: { kind: 'proposal' as const, proposalId: PROPOSAL, materialId: null, materialName: null },
      version: 0,
    };
    expect(termRow(term, t)).toEqual({
      id: TERM,
      label: 'Pontos de Vida',
      detail: 'medem a saúde · Também chamado: PV, HP · De material removido',
      href: null,
      state: null,
    });
  });
});
