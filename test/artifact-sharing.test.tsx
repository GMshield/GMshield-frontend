import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { ArtifactSharing } = await import('@/components/artifacts/ArtifactSharing');
const { artifactSharingTexts } = await import('@/app/(signed-in)/campaigns/[id]/artifacts/texts');
const { translator } = await import('@/messages');

type State = import('@/components/artifacts/ArtifactOverride').OverrideActionState;
type Campaign = import('@/components/artifacts/ArtifactSharing').SharingCampaign;

afterEach(() => {
  cleanup();
});

const CAMPAIGN = '0190a0b0-0000-7000-8000-000000000002';
const ARTIFACT = '0190a0b0-0000-7000-8000-000000000900';
const SYSTEM = '0190a0b0-0000-7000-8000-000000000001';
const SUNDAY: Campaign = { id: '0190a0b0-0000-7000-8000-000000000042', name: 'Mesa de domingo', archived: false, shared: false };
const THURSDAY: Campaign = { id: '0190a0b0-0000-7000-8000-000000000041', name: 'Mesa de quinta', archived: false, shared: true };
const OLD: Campaign = { id: '0190a0b0-0000-7000-8000-000000000043', name: 'Mesa antiga', archived: true, shared: true };

function renderSection(options: { language?: 'pt-BR' | 'en'; campaigns?: readonly Campaign[]; answer?: State } = {}) {
  const language = options.language ?? 'pt-BR';
  const posted: { campaignId: string; artifactId: string; campaignIds: string[] }[] = [];
  const action = vi.fn(async (_previous: State, form: FormData) => {
    posted.push({
      campaignId: String(form.get('campaignId')),
      artifactId: String(form.get('artifactId')),
      campaignIds: form.getAll('campaignIds').map(String),
    });
    return options.answer ?? { serial: 1, done: true, error: null };
  });
  const view = render(
    <ArtifactSharing
      campaignId={CAMPAIGN}
      artifactId={ARTIFACT}
      campaigns={options.campaigns ?? [SUNDAY, THURSDAY, OLD]}
      newCampaignHref={`/campaigns/new?system=${SYSTEM}`}
      texts={artifactSharingTexts(translator(language))}
      action={action}
    />,
  );
  return { ...view, posted, action };
}

describe('"Compartilhamento" on an artifact\'s page (Story 5.6 part A)', () => {
  it('lists the other campaigns as checkboxes, ticked when shared, an archived one marked "Arquivada", in a named group', () => {
    renderSection();

    expect(screen.getByRole('heading', { level: 2, name: 'Compartilhamento' })).toBeTruthy();
    const group = screen.getByRole('group', { name: 'Campanhas do sistema com este artefato' });
    const boxes = within(group).getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes.map((box) => box.closest('label')?.textContent)).toEqual(['Mesa de domingo', 'Mesa de quinta', 'Mesa antigaArquivada']);
    expect(boxes.map((box) => box.checked)).toEqual([false, true, true]);
    // Each box is named by its campaign, so a screen reader reads which one it is.
    expect(within(group).getByRole('checkbox', { name: /Mesa antiga/ })).toBeTruthy();
    expect(group.getAttribute('aria-describedby')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Nova campanha' })).toBeNull();
  });

  it('by keyboard: Tab reaches every box and "Salvar", Space ticks, and "Salvar" sends the whole set in the order shown', async () => {
    const user = userEvent.setup();
    const { posted } = renderSection();

    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('checkbox', { name: 'Mesa de domingo' }));
    await user.keyboard(' ');
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('checkbox', { name: 'Mesa de quinta' }));
    await user.keyboard(' ');
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('checkbox', { name: /Mesa antiga/ }));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Salvar' }));
    await user.keyboard('{Enter}');

    expect(posted).toEqual([{ campaignId: CAMPAIGN, artifactId: ARTIFACT, campaignIds: [SUNDAY.id, OLD.id] }]);
  });

  it('nothing ticked sends an empty set (it unshares it from every campaign)', async () => {
    const user = userEvent.setup();
    const { posted } = renderSection({ campaigns: [THURSDAY] });

    await user.click(screen.getByRole('checkbox', { name: 'Mesa de quinta' }));
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(posted).toEqual([{ campaignId: CAMPAIGN, artifactId: ARTIFACT, campaignIds: [] }]);
  });

  it('a refusal shows as an alert, and the boxes keep what was ticked', async () => {
    const user = userEvent.setup();
    renderSection({ answer: { serial: 1, done: false, error: 'Uma das campanhas marcadas não pode mais receber este artefato.' } });

    await user.click(screen.getByRole('checkbox', { name: 'Mesa de domingo' }));
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    expect((await screen.findByRole('alert')).textContent).toBe('Uma das campanhas marcadas não pode mais receber este artefato.');
    expect((screen.getByRole('checkbox', { name: 'Mesa de domingo' }) as HTMLInputElement).checked).toBe(true);
  });

  it('with no other campaign, one sentence and "Nova campanha" on the system, and no box or "Salvar"; in English too', () => {
    for (const [language, sentence, link] of [
      ['pt-BR', 'Este sistema não tem outra campanha com quem compartilhar este artefato.', 'Nova campanha'],
      ['en', 'This system has no other campaign to share this artifact with.', 'New campaign'],
    ] as const) {
      renderSection({ language, campaigns: [] });
      expect(screen.getByText(sentence)).toBeTruthy();
      expect(screen.getByRole('link', { name: link }).getAttribute('href')).toBe(`/campaigns/new?system=${SYSTEM}`);
      expect(screen.queryByRole('checkbox')).toBeNull();
      expect(screen.queryByRole('button')).toBeNull();
      cleanup();
    }
  });
});
