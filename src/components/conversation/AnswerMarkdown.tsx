import type { ReactNode } from 'react';
import Markdown, { type Components, type UrlTransform } from 'react-markdown';

import styles from './Conversation.module.css';

/** Every node's text, for a link's own words. */
function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(textOf).join('');
  }
  if (node !== null && typeof node === 'object' && 'props' in node) {
    return textOf((node.props as { children?: ReactNode }).children);
  }
  return '';
}

/** A reference's number shown as a superscript at a code-point offset of the answer's Markdown text (Story 2.5). */
export type CitationMark = { readonly offset: number; readonly number: number };

/**
 * A mark travels through the Markdown parser as one private-use code point (U+F0000 plus its number), which no
 * Markdown syntax reads and which the model's own text never keeps (`withMarks` drops any it carries).
 */
const SENTINEL_FIRST = 0xf0000;
const SENTINEL_LAST = 0xffffd;

function isSentinel(point: number): boolean {
  return point >= SENTINEL_FIRST && point <= SENTINEL_LAST;
}

/** Whitespace (line breaks included) and closing emphasis delimiters a mark is moved back over. */
const MOVED_OVER = /^[\s*_~]$/u;

/**
 * Where a mark goes: its offset (an offset past the end goes at the end), moved back over trailing whitespace and over
 * closing delimiters (`*`, `_`, `~`), so the superscript lands inside an emphasis that ends there and before a line
 * break (never before a block marker such as `#`, `-` or `1.` on the next line).
 */
function placeOf(points: readonly string[], offset: number): number {
  let at = Math.min(Math.max(0, Math.trunc(offset)), points.length);
  while (at > 0 && MOVED_OVER.test(points[at - 1] ?? '')) {
    at -= 1;
  }
  return at;
}

/**
 * The text with each mark's sentinel at its place (`placeOf`; marks at the same place keep their order). Every
 * sentinel the text already carries is dropped, its code point still counted.
 */
export function withMarks(text: string, marks: readonly CitationMark[]): string {
  const points = Array.from(text);
  const at = new Map<number, number[]>();
  for (const mark of marks) {
    if (!Number.isInteger(mark.number) || mark.number < 1 || mark.number > SENTINEL_LAST - SENTINEL_FIRST) {
      continue;
    }
    const offset = placeOf(points, mark.offset);
    at.set(offset, [...(at.get(offset) ?? []), mark.number]);
  }
  let marked = '';
  for (let index = 0; index <= points.length; index++) {
    for (const number of at.get(index) ?? []) {
      marked += String.fromCodePoint(SENTINEL_FIRST + number);
    }
    const point = points[index];
    if (point !== undefined && !isSentinel(point.codePointAt(0) ?? 0)) {
      marked += point;
    }
  }
  return marked;
}

/** The few shapes of the HTML tree (hast) the citation step reads and writes. */
type TreeText = { type: 'text'; value: string };
type TreeElement = { type: 'element'; tagName: string; properties: Record<string, unknown>; children: TreeNode[] };
type TreeNode = TreeText | TreeElement | { type: string; children?: TreeNode[] };

/** The visually hidden word said before a superscript's number. */
function hidden(word: string): TreeElement {
  return {
    type: 'element',
    tagName: 'span',
    properties: { className: [styles.visuallyHidden] },
    children: [{ type: 'text', value: `${word} ` }],
  };
}

/**
 * A text node's value split at its sentinels: text, then a superscript with a visually hidden word ("fonte ") and the
 * number, and so on.
 */
function split(value: string, word: string): TreeNode[] {
  const nodes: TreeNode[] = [];
  let run = '';
  for (const point of value) {
    const code = point.codePointAt(0) ?? 0;
    if (!isSentinel(code)) {
      run += point;
      continue;
    }
    if (run !== '') {
      nodes.push({ type: 'text', value: run });
      run = '';
    }
    nodes.push({
      type: 'element',
      tagName: 'sup',
      properties: { className: [styles.citation] },
      children: [...(word === '' ? [] : [hidden(word)]), { type: 'text', value: String(code - SENTINEL_FIRST) }],
    });
  }
  if (run !== '') {
    nodes.push({ type: 'text', value: run });
  }
  return nodes;
}

function mark(node: TreeNode, word: string): void {
  if (!('children' in node) || !Array.isArray(node.children)) {
    return;
  }
  node.children = node.children.flatMap((child) => {
    if (child.type === 'text' && 'value' in child) {
      return split(child.value, word);
    }
    mark(child, word);
    return [child];
  });
}

/** The rehype step that turns each sentinel into a `<sup>` with its number, in the reference's accent. */
function rehypeCitations(word: string) {
  return () => (tree: { type: string }) => {
    mark(tree as TreeNode, word);
  };
}

/**
 * Story 2.8: a link's address is only ever shown as text (`a` renders a span, never an anchor), so it is kept as written,
 * a `javascript:` one included, and the GM sees where a link would go; every other URL (an image's) is dropped.
 */
const addressAsText: UrlTransform = (url, key, node) => (node.tagName === 'a' && key === 'href' ? url : '');

export type AnswerMarkdownProps = {
  readonly text: string;
  /** A link's words with its address, as the interface writes them ("{text} ({address})"). */
  readonly linkText: (text: string, address: string) => string;
  /** Story 2.5: the superscripts of a finished answer, at code-point offsets of `text`. */
  readonly marks?: readonly CitationMark[];
  /** The visually hidden word said before a superscript's number ("fonte"), so a reader hears "fonte 1". */
  readonly citationWord?: string;
};

/**
 * An answer's text as sanitized Markdown (Story 2.4): raw HTML in the text is skipped (`skipHtml`, never rendered),
 * images are dropped, and a link is shown as its words with its address (any address, `addressAsText`), never as an
 * anchor. Nothing is set as HTML.
 * Story 2.5: each mark becomes a superscript with its reference's number at its code-point offset.
 */
export function AnswerMarkdown({ text, linkText, marks = [], citationWord = '' }: AnswerMarkdownProps) {
  const components: Components = {
    img: () => null,
    a: ({ href, children }) => {
      const words = textOf(children);
      const address = typeof href === 'string' ? href : '';
      return <span>{address === '' || address === words ? words : linkText(words, address)}</span>;
    },
  };
  return (
    <Markdown
      skipHtml
      disallowedElements={['img']}
      urlTransform={addressAsText}
      components={components}
      rehypePlugins={[rehypeCitations(citationWord)]}
    >
      {withMarks(text, marks)}
    </Markdown>
  );
}
