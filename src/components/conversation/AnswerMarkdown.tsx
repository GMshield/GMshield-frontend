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

/** Whitespace (line breaks included) and closing emphasis delimiters a mark is moved back over. */
const MOVED_OVER = /^[\s*_~]$/u;

/**
 * Where a mark goes, in code points: its offset (an offset past the end goes at the end), moved back over trailing
 * whitespace and over closing delimiters (`*`, `_`, `~`), so the superscript lands inside an emphasis that ends there and
 * before a line break (never before a block marker such as `#`, `-` or `1.` on the next line).
 */
function placeOf(points: readonly string[], offset: number): number {
  let at = Math.min(Math.max(0, Math.trunc(offset)), points.length);
  while (at > 0 && MOVED_OVER.test(points[at - 1] ?? '')) {
    at -= 1;
  }
  return at;
}

/** The few shapes of the Markdown tree (mdast) the citation step reads and writes; offsets are UTF-16 units. */
type TreeNode = {
  type: string;
  value?: string;
  children?: TreeNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
  data?: Record<string, unknown>;
};

/** Nodes whose children are text and inline nodes: a mark inside one stays inline. */
const PHRASING = new Set(['paragraph', 'heading', 'emphasis', 'strong']);

/** Inline nodes a mark enters; any other inline node (code, a link, an image) takes the mark right after it. */
const INLINE_CONTAINERS = new Set(['emphasis', 'strong']);

/** A character reference (`&amp;`, `&#42;`, `&#x2A;`): one character of a text node's value, several of its source. */
const REFERENCE = /^&(?:#\d{1,7}|#[xX][\da-fA-F]{1,6}|[A-Za-z][A-Za-z\d]{0,31});/u;

/**
 * Where each mark lands in the tree: inside a text node (at an index of its value), before a line break, after an inline
 * node, at the start of an inline parent, in a paragraph after a block (a code block, a rule; unwrapped in a tight list
 * item), or in a paragraph of an otherwise empty container. Numbers at one place keep their order.
 */
type Places = {
  readonly inText: Map<TreeNode, Map<number, number[]>>;
  readonly before: Map<TreeNode, number[]>;
  readonly after: Map<TreeNode, number[]>;
  readonly first: Map<TreeNode, number[]>;
  readonly below: Map<TreeNode, number[]>;
  readonly alone: Map<TreeNode, number[]>;
};

function add<Key>(map: Map<Key, number[]>, key: Key, number: number): void {
  map.set(key, [...(map.get(key) ?? []), number]);
}

function startOf(node: TreeNode): number {
  return node.position?.start.offset ?? -1;
}

function endOf(node: TreeNode): number {
  return node.position?.end.offset ?? -1;
}

/**
 * One step of walking a text node's source and value together: how far it moves in each. A reference the parser decoded
 * is its whole name in the source and one character (one or two UTF-16 units) in the value; a U+0000 in the source is a
 * U+FFFD in the value; any other source character the value does not have next is the source's own syntax.
 */
function stepOf(source: string, cursor: number, value: string, index: number): readonly [number, number] {
  const reference = source[cursor] === '&' ? REFERENCE.exec(source.slice(cursor, cursor + 40)) : null;
  if (reference !== null && !value.startsWith(reference[0], index)) {
    return [reference[0].length, /[\uD800-\uDBFF]/u.test(value[index] ?? '') ? 2 : 1];
  }
  const point = source[cursor];
  if (point === value[index] || (point === '\u0000' && value[index] === '\uFFFD')) {
    return [1, 1];
  }
  return [1, 0];
}

/**
 * The index in a text node's value of the source offset `at` (inside the node's source): the source and the value are
 * walked together (`stepOf`), the source's own syntax (an escape's `\`, a container's `> ` or indentation, a reference's
 * name) skipped.
 */
function indexIn(text: TreeNode, source: string, at: number): number {
  const value = text.value ?? '';
  if (at >= endOf(text)) {
    return value.length;
  }
  let index = 0;
  let cursor = startOf(text);
  while (cursor < at && index < value.length) {
    const [inSource, inValue] = stepOf(source, cursor, value, index);
    cursor += inSource;
    index += inValue;
  }
  return index;
}

/** Records where a mark at the source offset `at` lands, looking from `parent` down. */
function locate(parent: TreeNode, at: number, source: string, number: number, places: Places): void {
  // The first child holding the offset: at a boundary, the one the mark follows.
  const child = (parent.children ?? []).find((node) => startOf(node) <= at && at <= endOf(node));
  if (child === undefined) {
    locateBetween(parent, at, source, number, places);
  } else if (PHRASING.has(parent.type)) {
    locateInline(child, at, source, number, places);
  } else if (child.type !== 'code' && Array.isArray(child.children)) {
    locate(child, at, source, number, places);
  } else {
    add(places.below, child, number);
  }
}

/**
 * A mark between `parent`'s children (on a container's syntax): at the end of the child before it, else at the start of
 * an inline parent, else at the start of the child after it, else in a paragraph of its own (an empty container).
 */
function locateBetween(parent: TreeNode, at: number, source: string, number: number, places: Places): void {
  const children = parent.children ?? [];
  const preceding = children.findLast((node) => endOf(node) >= 0 && endOf(node) <= at);
  const following = children.find((node) => startOf(node) >= at);
  if (preceding !== undefined) {
    locate(parent, endOf(preceding), source, number, places);
  } else if (PHRASING.has(parent.type)) {
    add(places.first, parent, number);
  } else if (following !== undefined) {
    locate(parent, startOf(following), source, number, places);
  } else {
    add(places.alone, parent, number);
  }
}

/** A mark on an inline `child`: inside its text, before a line break, inside an emphasis, else right after the node. */
function locateInline(child: TreeNode, at: number, source: string, number: number, places: Places): void {
  if (child.type === 'text') {
    const marks = places.inText.get(child) ?? new Map<number, number[]>();
    add(marks, indexIn(child, source, at), number);
    places.inText.set(child, marks);
  } else if (child.type === 'break') {
    add(places.before, child, number);
  } else if (INLINE_CONTAINERS.has(child.type)) {
    locate(child, at, source, number, places);
  } else {
    add(places.after, child, number);
  }
}

/** The visually hidden word said before a superscript's number, as an HTML (hast) element. */
function hidden(word: string) {
  return {
    type: 'element',
    tagName: 'span',
    properties: { className: [styles.visuallyHidden] },
    children: [{ type: 'text', value: `${word} ` }],
  };
}

/** A superscript with a visually hidden word ("fonte ") and the number, in the reference's accent. */
function superscripts(numbers: readonly number[], word: string): TreeNode[] {
  return numbers.map((number) => ({
    type: 'citation',
    data: {
      hName: 'sup',
      hProperties: { className: [styles.citation] },
      hChildren: [...(word === '' ? [] : [hidden(word)]), { type: 'text', value: String(number) }],
    },
  }));
}

/** A paragraph holding only superscripts. */
function paragraphOf(numbers: readonly number[], word: string): TreeNode {
  return { type: 'paragraph', children: superscripts(numbers, word) };
}

/** A text node split at its marks: text, the superscripts there, text, and so on (no empty text). */
function split(text: TreeNode, marks: Map<number, number[]>, word: string): TreeNode[] {
  const value = text.value ?? '';
  const nodes: TreeNode[] = [];
  let from = 0;
  for (const index of [...marks.keys()].sort((one, other) => one - other)) {
    if (index > from) {
      nodes.push({ type: 'text', value: value.slice(from, index) });
      from = index;
    }
    nodes.push(...superscripts(marks.get(index) ?? [], word));
  }
  if (value.length > from) {
    nodes.push({ type: 'text', value: value.slice(from) });
  }
  return nodes;
}

/** Puts every recorded superscript in the tree under `parent`. */
function insert(parent: TreeNode, places: Places, word: string): void {
  if (!Array.isArray(parent.children)) {
    return;
  }
  const children: TreeNode[] = superscripts(places.first.get(parent) ?? [], word);
  for (const child of parent.children) {
    children.push(...superscripts(places.before.get(child) ?? [], word));
    const marks = places.inText.get(child);
    if (marks === undefined) {
      insert(child, places, word);
      children.push(child);
    } else {
      children.push(...split(child, marks, word));
    }
    children.push(...superscripts(places.after.get(child) ?? [], word));
    const below = places.below.get(child);
    if (below !== undefined) {
      children.push(paragraphOf(below, word));
    }
  }
  const alone = places.alone.get(parent);
  if (alone !== undefined) {
    children.push(paragraphOf(alone, word));
  }
  parent.children = children;
}

/**
 * The remark step that places each mark in the parsed Markdown tree (the text itself is never changed): at its place
 * (`placeOf`, in code points, turned into the tree's UTF-16 offsets) as a superscript after the text it follows. A mark
 * on or inside a code block (fenced or indented, in any container, closed or not) goes in a paragraph right after the
 * block, in the same container (in a tight list item that paragraph is unwrapped, so the superscript sits directly in
 * the `li` after the `pre`); one on or inside inline code or a link goes right after it. Marks at one place keep their
 * order.
 */
function remarkCitations(text: string, marks: readonly CitationMark[], word: string) {
  return () => (tree: { type: string }) => {
    const points = Array.from(text);
    // The UTF-16 offset of each code-point offset.
    const units = [0];
    for (const point of points) {
      units.push((units.at(-1) ?? 0) + point.length);
    }
    const placed = marks
      .filter((mark) => Number.isInteger(mark.number) && mark.number >= 1)
      .map((mark) => ({ number: mark.number, at: units[placeOf(points, mark.offset)] ?? text.length }))
      .sort((one, other) => one.at - other.at);
    const places: Places = {
      inText: new Map(),
      before: new Map(),
      after: new Map(),
      first: new Map(),
      below: new Map(),
      alone: new Map(),
    };
    for (const mark of placed) {
      locate(tree as TreeNode, mark.at, text, mark.number, places);
    }
    insert(tree as TreeNode, places, word);
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
 * Story 2.5: each mark becomes a superscript with its reference's number at its code-point offset (`remarkCitations`).
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
      remarkPlugins={[remarkCitations(text, marks, citationWord)]}
    >
      {text}
    </Markdown>
  );
}
