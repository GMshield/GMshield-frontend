import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

/** Story 4.3: a record's references and the source view on the record's ground. */
const { SourceView } = await import('@/components/SourceView');
const { RecordReferences, recordReferenceLine } = await import('@/components/RecordReferences');
const { translator } = await import('@/messages');

type SourcePage = import('@/client/conversation').SourcePage;
type RecordReference = import('@/server/library').RecordReference;

const SYSTEM = '0190a0b0-0000-7000-8000-000000000001';
const RECORD = '0190a0b0-0000-7000-8000-000000000700';
const VERSION = '0190a0b0-0000-7000-8000-000000000071';

const PASSAGE_241 = '0190a0b0-0000-7000-8000-000000000801';
const PASSAGE_242 = '0190a0b0-0000-7000-8000-000000000802';
const OTHER_PASSAGE = '0190a0b0-0000-7000-8000-000000000803';

const REFERENCES: RecordReference[] = [
  { versionId: VERSION, materialName: 'Livro do Jogador.pdf', sectionPath: ['Magias', 'Bola de Fogo'], page: 241, passageIds: [PASSAGE_241] },
  { versionId: VERSION, materialName: 'Livro do Jogador.pdf', sectionPath: [], page: 242, passageIds: [PASSAGE_242] },
];

/** A text page: "Texto da página N." then one passage of the record's (its first word) and one that is not. */
function textPage(page: number, pageTotal = 300): SourcePage {
  const own = page === 241 ? PASSAGE_241 : PASSAGE_242;
  return {
    page,
    pageTotal,
    picture: null,
    lines: [],
    text: `Texto da página ${page}.`,
    passages: [
      { id: own, range: [0, 5] },
      { id: OTHER_PASSAGE, range: [6, 8] },
    ],
    outcome: 'read_directly',
  };
}

afterEach(() => {
  cleanup();
});

describe('the source view on the ground of a record (Story 4.3)', () => {
  it("reads a page of the record's version and its picture from the record's relays, and turns to its other pages", async () => {
    const user = userEvent.setup();
    const picturePage: SourcePage = {
      ...textPage(241),
      picture: { width: 100, height: 200 },
      text: null,
      passages: [
        { id: PASSAGE_241, boxes: [[0.1, 0.1, 0.5, 0.2]] },
        { id: OTHER_PASSAGE, boxes: [[0.1, 0.3, 0.5, 0.4], [0.1, 0.5, 0.5, 0.6]] },
      ],
    };
    const loadRecord = vi.fn(async (_system: string, _record: string, page: number) => (page === 241 ? picturePage : textPage(page)));
    render(
      <SourceView
        ground={{ kind: 'record', systemId: SYSTEM, recordId: RECORD }}
        reference={{ materialName: 'Livro do Jogador.pdf', sectionPath: ['Magias'], page: 241, passageIds: [PASSAGE_241] }}
        language="pt-BR"
        onClose={() => undefined}
        loadRecord={loadRecord}
      />,
    );
    const view = screen.getByRole('dialog', { name: 'Livro do Jogador.pdf, Magias' });
    await waitFor(() => expect(view.querySelector('image')).not.toBeNull());
    expect(view.querySelector('image')?.getAttribute('href')).toBe(`/api/v1/systems/${SYSTEM}/records/${RECORD}/pages/241/picture`);
    expect(loadRecord).toHaveBeenCalledWith(SYSTEM, RECORD, 241, expect.any(AbortSignal));
    // The record's passage on the page is marked (its one box), and the page's other passage is not.
    expect(view.querySelectorAll('[data-cited]')).toHaveLength(1);
    await user.click(within(view).getByRole('button', { name: 'Próxima página' }));
    await waitFor(() => expect(within(view).getByText(/da página 242\./)).toBeTruthy());
    expect(loadRecord).toHaveBeenLastCalledWith(SYSTEM, RECORD, 242, expect.any(AbortSignal));
  });
});

describe("a record's references (Story 4.3)", () => {
  it('writes each reference as one line: the material, the section path and the page', () => {
    const t = translator('pt-BR');
    expect(recordReferenceLine(REFERENCES[0]!, t)).toBe('Livro do Jogador.pdf, Magias › Bola de Fogo, p. 241');
    expect(recordReferenceLine(REFERENCES[1]!, t)).toBe('Livro do Jogador.pdf, p. 242');
  });

  it('opens the source view at the reference\'s page from a click or from Enter, and gives focus back to it on Esc', async () => {
    const user = userEvent.setup();
    const loadRecord = vi.fn(async (_system: string, _record: string, page: number) => textPage(page));
    render(<RecordReferences systemId={SYSTEM} recordId={RECORD} references={REFERENCES} language="pt-BR" loadRecord={loadRecord} />);

    const section = screen.getByRole('region', { name: 'Fontes' });
    const lines = within(section).getAllByRole('button');
    expect(lines.map((line) => line.textContent)).toEqual(['Livro do Jogador.pdf, Magias › Bola de Fogo, p. 241', 'Livro do Jogador.pdf, p. 242']);
    expect(screen.queryByRole('dialog')).toBeNull();

    await user.click(lines[0]!);
    let view = screen.getByRole('dialog', { name: 'Livro do Jogador.pdf, Magias › Bola de Fogo' });
    await waitFor(() => expect(view.querySelector('[data-cited]')).not.toBeNull());
    expect(loadRecord).toHaveBeenCalledWith(SYSTEM, RECORD, 241, expect.any(AbortSignal));
    expect(lines[0]!.getAttribute('data-open')).toBe('true');
    // The opened page marks the passages the reference names: the record's, not the page's other one.
    expect([...view.querySelectorAll('[data-cited]')].map((mark) => mark.textContent)).toEqual(['Texto']);
    // Focus is on the view's close control; Esc closes it and focus goes back to the line.
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(lines[0]);

    // From the keyboard: Tab to the second line, Enter.
    await user.tab();
    expect(document.activeElement).toBe(lines[1]);
    await user.keyboard('{Enter}');
    view = screen.getByRole('dialog', { name: 'Livro do Jogador.pdf' });
    await waitFor(() => expect(view.querySelector('[data-cited]')).not.toBeNull());
    expect([...view.querySelectorAll('[data-cited]')].map((mark) => mark.textContent)).toEqual(['Texto']);
    await user.click(within(view).getByRole('button', { name: 'Fechar a fonte' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(lines[1]);
    act(() => undefined);
  });

  it('reads in English', () => {
    render(<RecordReferences systemId={SYSTEM} recordId={RECORD} references={REFERENCES} language="en" />);
    expect(screen.getByRole('region', { name: 'Sources' })).toBeTruthy();
  });
});
