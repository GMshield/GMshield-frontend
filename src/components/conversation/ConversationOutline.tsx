'use client';

import { useEffect, useRef, useState } from 'react';

import styles from './ConversationOutline.module.css';

/** One question of the conversation, by its turn's key (its `<li>` carries `data-turn-key`). */
export type OutlineItem = { readonly key: number; readonly question: string };

/** The turn element of a key, in this document. */
function turnOf(key: number): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-turn-key="${key}"]`);
}

/**
 * How far below the window's top a question's top must have come to be the one being read: past the room a question
 * brought to the top keeps above it (its scroll margin), short of the next one when answers are short.
 */
const READING_LINE = 120;

/**
 * The key of the question being read: the last turn whose top has reached `READING_LINE`, the first when none has, and
 * the last when the page is scrolled to its end.
 */
export function readingKey(keys: readonly number[]): number | null {
  if (keys.length === 0) {
    return null;
  }
  const root = document.documentElement;
  if (window.scrollY > 0 && window.scrollY + window.innerHeight >= root.scrollHeight - 2) {
    return keys.at(-1) ?? null;
  }
  let reading = keys[0] ?? null;
  for (const key of keys) {
    const element = turnOf(key);
    if (element !== null && element.getBoundingClientRect().top <= READING_LINE) {
      reading = key;
    }
  }
  return reading;
}

export type OutlineLabels = {
  /** The outline's heading, "Nesta conversa". */
  readonly title: string;
  /** How many questions, "28 perguntas". */
  readonly count: string;
};

/**
 * The conversation's outline (2026-11-23, replacing the rail of marks Dalton found unclear): beside the conversation,
 * as a documentation page's "On this page", a titled, numbered list of the questions asked, each by its first two
 * lines, the one being read marked by an accent bar and weight as the page scrolls. Pressing one brings that question
 * to the top of the window. It stays in view while the conversation scrolls, and scrolls itself to keep the question
 * being read in view. It shows from two questions up, where the conversation's frame has room for it (the stylesheet).
 */
export function ConversationOutline({ items, labels }: { readonly items: readonly OutlineItem[]; readonly labels: OutlineLabels }) {
  const [reading, setReading] = useState<number | null>(null);
  const list = useRef<HTMLOListElement>(null);
  // Which questions there are, as text: an answer being written renders often, and only a new or dismissed question
  // changes what is followed.
  const keys = items.map((item) => item.key).join(' ');

  useEffect(() => {
    const followed = keys === '' ? [] : keys.split(' ').map(Number);
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

  // The question being read stays in view in a long outline: the outline scrolls, never the page.
  useEffect(() => {
    const box = list.current;
    const entry = box?.querySelector<HTMLElement>('[aria-current="true"]');
    if (box === null || box === undefined || entry === null || entry === undefined) {
      return;
    }
    const top = entry.offsetTop - box.offsetTop;
    if (top < box.scrollTop) {
      box.scrollTop = top;
    } else if (top + entry.offsetHeight > box.scrollTop + box.clientHeight) {
      box.scrollTop = top + entry.offsetHeight - box.clientHeight;
    }
  }, [reading]);

  if (items.length < 2) {
    return null;
  }
  const go = (key: number) => {
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    turnOf(key)?.scrollIntoView?.({ block: 'start', behavior: still ? 'auto' : 'smooth' });
    setReading(key);
  };
  return (
    <nav className={styles.outline} aria-labelledby="conversation-outline-title" data-testid="conversation-outline">
      <p id="conversation-outline-title" className={styles.title}>
        {labels.title}
        <span className={styles.count}>{labels.count}</span>
      </p>
      <ol ref={list} className={styles.entries}>
        {items.map((item, index) => (
          <li key={item.key}>
            <button
              type="button"
              className={styles.entry}
              aria-current={item.key === reading ? 'true' : undefined}
              onClick={() => go(item.key)}
            >
              <span className={styles.number} aria-hidden="true">
                {index + 1}
              </span>
              <span className={styles.question}>{item.question}</span>
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}
