/**
 * The conversation's timeline (2026-11-23, outside any story): one mark per question, named by its first words, that
 * brings its question to the top; none for a single question; and the rail's place in the stylesheet (wide screens
 * only, never beside an open right panel, the conversation under it still usable).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { ConversationTimeline, firstWords } = await import('@/components/conversation/ConversationTimeline');

const ITEMS = [
  { key: 1, question: 'How does grappling work?' },
  { key: 2, question: 'Can a rogue use Sneak Attack with a thrown dagger when the target is prone and an ally is next to it?' },
  { key: 3, question: 'How long is a short rest?' },
];

function page(items: typeof ITEMS) {
  return render(
    <>
      <ol>
        {items.map((item) => (
          <li key={item.key} data-turn-key={item.key}>
            {item.question}
          </li>
        ))}
      </ol>
      <ConversationTimeline items={items} label="Questions in this conversation" />
    </>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('the conversation timeline', () => {
  it('names each question by its first words, cut at a word', () => {
    expect(firstWords('  How   does grappling\nwork? ')).toBe('How does grappling work?');
    const long = firstWords(ITEMS[1]!.question);
    expect(long.endsWith('…')).toBe(true);
    expect(Array.from(long).length).toBeLessThanOrEqual(71);
    expect(ITEMS[1]!.question.startsWith(long.slice(0, -1))).toBe(true);
    expect(long.at(-2)).not.toBe(' ');
  });

  it('has one mark per question, in order, and brings a question to the top of the window', async () => {
    const scrolled: Element[] = [];
    Element.prototype.scrollIntoView = vi.fn(function scrollIntoView(this: Element) {
      scrolled.push(this);
    });
    page(ITEMS);
    const rail = screen.getByRole('navigation', { name: 'Questions in this conversation' });
    const marks = rail.querySelectorAll('button');
    expect([...marks].map((mark) => mark.textContent)).toEqual([
      'How does grappling work?',
      firstWords(ITEMS[1]!.question),
      'How long is a short rest?',
    ]);
    await userEvent.click(screen.getByRole('button', { name: 'How long is a short rest?' }));
    expect(scrolled).toHaveLength(1);
    expect(scrolled[0]?.getAttribute('data-turn-key')).toBe('3');
    expect(screen.getByRole('button', { name: 'How long is a short rest?' }).getAttribute('aria-current')).toBe('true');
  });

  it('shows nothing for a single question', () => {
    page(ITEMS.slice(0, 1));
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('sits in the right gutter of a wide screen only, never beside an open right panel', () => {
    const css = readFileSync(join(process.cwd(), 'src/components/conversation/ConversationTimeline.module.css'), 'utf8');
    const rail = /\.rail \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rail).toMatch(/position: fixed;/);
    expect(rail).toMatch(/pointer-events: none;/);
    expect(css).toMatch(/@media \(max-width: 1279px\) \{\s*\.rail \{\s*display: none;/);
    expect(css).toMatch(/\[data-panel\]:not\(\[data-panel='none'\]\) \.rail \{\s*display: none;/);
    // Only a mark takes the pointer, and its name never does.
    expect(/\.mark \{([^}]*)\}/.exec(css)?.[1]).toMatch(/pointer-events: auto;/);
    expect(/\.name \{([^}]*)\}/.exec(css)?.[1]).toMatch(/pointer-events: none;/);
  });
});
