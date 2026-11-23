'use client';

import { useEffect, useState } from 'react';

import styles from './ConversationTimeline.module.css';

/** One question of the conversation, by its turn's key (its `<li>` carries `data-turn-key`). */
export type TimelineItem = { readonly key: number; readonly question: string };

/** How many code points of a question its mark names, cut at a word. */
const NAMED = 70;

/** A question's first words for its mark: at most `NAMED` code points, cut at a word, with an ellipsis when cut. */
export function firstWords(question: string): string {
  const points = Array.from(question.replace(/\s+/g, ' ').trim());
  if (points.length <= NAMED) {
    return points.join('');
  }
  const cut = points.slice(0, NAMED).join('');
  const space = cut.lastIndexOf(' ');
  return `${(space > NAMED / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** The turn element of a key, in this document. */
function turnOf(key: number): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-turn-key="${key}"]`);
}

/**
 * The key of the question being read: the last turn whose top has passed a third of the window, the first when none
 * has, and the last when the page is scrolled to its end.
 */
function readingKey(items: readonly TimelineItem[]): number | null {
  if (items.length === 0) {
    return null;
  }
  const root = document.documentElement;
  if (window.scrollY > 0 && window.scrollY + window.innerHeight >= root.scrollHeight - 2) {
    return items.at(-1)?.key ?? null;
  }
  let reading = items[0]?.key ?? null;
  for (const item of items) {
    const element = turnOf(item.key);
    if (element !== null && element.getBoundingClientRect().top <= window.innerHeight / 3) {
      reading = item.key;
    }
  }
  return reading;
}

/**
 * The conversation's timeline (2026-11-23, Dalton's "slim rail"): one mark per question asked, in order, in the right
 * gutter of a wide screen, the one being read marked as the page scrolls. A mark names its question's first words when
 * pointed at or focused, and brings that question to the top of the window. It shows from two questions up, from
 * 1280px, and not while a right panel (the source view, the saved items) is open, which takes that side.
 */
export function ConversationTimeline({ items, label }: { readonly items: readonly TimelineItem[]; readonly label: string }) {
  const [reading, setReading] = useState<number | null>(null);
  // Which questions there are, as text: an answer being written renders often, and only a new or dismissed question
  // changes what is followed.
  const keys = items.map((item) => item.key).join(' ');

  useEffect(() => {
    const followed: readonly TimelineItem[] = keys === '' ? [] : keys.split(' ').map((key) => ({ key: Number(key), question: '' }));
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setReading(readingKey(followed)));
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [keys]);

  if (items.length < 2) {
    return null;
  }
  const go = (key: number) => {
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    turnOf(key)?.scrollIntoView?.({ block: 'start', behavior: still ? 'auto' : 'smooth' });
    setReading(key);
  };
  return (
    <nav className={styles.rail} aria-label={label} data-testid="conversation-timeline">
      <ol className={styles.marks}>
        {items.map((item) => (
          <li key={item.key} className={styles.item}>
            <button
              type="button"
              className={styles.mark}
              aria-current={item.key === reading ? 'true' : undefined}
              onClick={() => go(item.key)}
            >
              <span className={styles.name}>{firstWords(item.question)}</span>
              <span className={styles.tick} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
