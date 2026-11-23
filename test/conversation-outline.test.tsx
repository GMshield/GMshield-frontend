/**
 * The conversation's outline (2026-11-23, outside any story; it replaced the rail of marks): a titled, numbered list of
 * the questions beside the conversation, the one being read marked, a press bringing its question to the top; none for
 * a single question; and its place in the stylesheets (only where the conversation's frame has room).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { ConversationOutline } = await import('@/components/conversation/ConversationOutline');

const ITEMS = [
  { key: 1, question: 'How does grappling work?' },
  { key: 2, question: 'Can a rogue use Sneak Attack with a thrown dagger when the target is prone and an ally is next to it?' },
  { key: 3, question: 'How long is a short rest?' },
];

const LABELS = { title: 'In this conversation', count: '3 questions' };

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
      <ConversationOutline items={items} labels={LABELS} />
    </>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('the conversation outline', () => {
  it('is a navigation titled by its heading, with the count, and one numbered entry per question, in order', () => {
    page(ITEMS);
    const outline = screen.getByRole('navigation', { name: /In this conversation/ });
    expect(within(outline).getByText('3 questions')).toBeTruthy();
    const entries = within(outline).getAllByRole('button');
    expect(entries.map((entry) => entry.textContent)).toEqual(ITEMS.map((item, index) => `${index + 1}${item.question}`));
    // The number is decoration: each entry is named by its question.
    expect(within(outline).getByRole('button', { name: 'How long is a short rest?' })).toBeTruthy();
  });

  it('a press brings its question to the top of the window and marks it as the one being read', async () => {
    const scrolled: Element[] = [];
    Element.prototype.scrollIntoView = vi.fn(function scrollIntoView(this: Element) {
      scrolled.push(this);
    });
    page(ITEMS);
    await userEvent.click(screen.getByRole('button', { name: 'How does grappling work?' }));
    expect(scrolled.map((element) => element.getAttribute('data-turn-key'))).toEqual(['1']);
    expect(screen.getByRole('button', { name: 'How does grappling work?' }).getAttribute('aria-current')).toBe('true');
    expect(screen.getAllByRole('button').filter((entry) => entry.getAttribute('aria-current') === 'true')).toHaveLength(1);
  });

  it('shows nothing for a single question', () => {
    page(ITEMS.slice(0, 1));
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('shows only where the conversation frame has room, beside the conversation or in the room a wide screen leaves, staying in view', () => {
    const outline = readFileSync(join(process.cwd(), 'src/components/conversation/ConversationOutline.module.css'), 'utf8');
    expect(/\.outline \{([^}]*)\}/.exec(outline)?.[1]).toMatch(/position: sticky;[\s\S]*display: none;/);
    expect(outline).toMatch(/@container conversation-frame \(min-width: 960px\) \{\s*\.outline \{\s*display: flex;/);
    // The question being read: an accent bar (a border, never a fill) and the text colour.
    expect(outline).toMatch(/\.entry\[aria-current='true'\] \{[^}]*border-inline-start-color: var\(--color-accent\);/);
    const conversation = readFileSync(join(process.cwd(), 'src/components/conversation/Conversation.module.css'), 'utf8');
    expect(conversation).toMatch(/\.frame \{[^}]*container: conversation-frame \/ inline-size;/);
    expect(conversation).toMatch(/@container conversation-frame \(min-width: 960px\) \{\s*\.layout:has\(> nav\) \{\s*grid-template-columns: minmax\(0, var\(--width-prose\)\) 14rem;/);
    // A wide screen: the conversation centred, as the bar above it, and the outline in the room at its right; from
    // 1280px the frame takes the column's whole width, past the reading width, to find that room.
    expect(conversation).toMatch(/@container conversation-frame \(min-width: 1312px\) \{\s*\.layout:has\(> nav\) \{\s*grid-template-columns: minmax\(0, 1fr\) minmax\(0, var\(--width-prose\)\) minmax\(0, 1fr\);/);
    expect(conversation).toMatch(/\.layout > nav \{\s*grid-column: 3;\s*justify-self: center;/);
    expect(conversation).toMatch(/@media \(min-width: 1280px\) \{\s*\.frame \{[^}]*100vw - var\(--sidebar-track, 0px\) - var\(--panel-track, 0px\)/);
  });
});
