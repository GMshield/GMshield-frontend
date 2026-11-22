import type { ReactNode } from 'react';
import Markdown, { type Components, type UrlTransform } from 'react-markdown';

import type { TurnTier } from '@/client/conversation';

import { TIER_SEPARATOR } from '../TierLabel';
import tierStyles from '../TierLabel.module.css';
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
 * Story 3.7: a tier's version of the answer starts at a code-point offset of its Markdown text, shown there as the tier
 * pill (`TierLabel`) with its word. Story 3.8: the model's own knowledge has `spoken`, what a reader hears for its pill
 * ("Do conhecimento do modelo, sem fonte."), which also closes that part as a muted line after its last block, where a
 * superscript would be: at `end` (the offset where the next tier's version starts), or at the answer's end without it.
 */
export type TierMark = {
  readonly offset: number;
  readonly tier: TurnTier;
  readonly label: string;
  readonly spoken?: string;
  readonly end?: number;
};

/**
 * What the step puts in the tree: a citation's superscript, a tier's pill, or (Story 3.8) the muted line that closes
 * the model's own knowledge.
 */
type Mark =
  | { readonly kind: 'citation'; readonly number: number }
  | { readonly kind: 'tier'; readonly tier: TurnTier; readonly label: string; readonly spoken: string | null }
  | { readonly kind: 'end'; readonly text: string };

/** Whitespace (line breaks included) and closing emphasis delimiters a mark is moved back over. */
const MOVED_OVER = /^[\s*_~]$/u;

/** Whitespace a tier pill is moved forward over, so it opens the paragraph its version starts. */
const MOVED_FORWARD = /^\s$/u;

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

/**
 * Where a tier pill goes, in code points (Story 3.7): its offset (past the end goes at the end), moved forward over
 * whitespace, so it lands at the start of the version it opens, never at the end of the paragraph before.
 */
function tierPlaceOf(points: readonly string[], offset: number): number {
  let at = Math.min(Math.max(0, Math.trunc(offset)), points.length);
  while (at < points.length && MOVED_FORWARD.test(points[at] ?? '')) {
    at += 1;
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

// PHRASING and INLINE_CONTAINERS are complete only because remark-gfm is not enabled: adding GFM must extend them
// for `delete` (strikethrough) and table cells.
/** Nodes whose children are text and inline nodes: a mark inside one stays inline. */
const PHRASING = new Set(['paragraph', 'heading', 'emphasis', 'strong']);

/** Inline nodes a mark enters; any other inline node (code, a link, an image) takes the mark right after it. */
const INLINE_CONTAINERS = new Set(['emphasis', 'strong']);

/** A character reference (`&amp;`, `&#42;`, `&#x2A;`): one character of a text node's value, several of its source. */
const REFERENCE = /^&(?:#\d{1,7}|#[xX][\da-fA-F]{1,6}|[A-Za-z][A-Za-z\d]{0,31});/u;

/**
 * Where each mark lands in the tree: inside a text node (at an index of its value), before a line break (or, a tier
 * pill, before an inline node it opens), after an inline node, at the start of an inline parent, in a paragraph after a
 * block (a code block, a rule; unwrapped in a tight list item; a tier pill in one before the block it opens), or in a
 * paragraph of an otherwise empty container. Marks at one place keep their order.
 */
type Places = {
  readonly inText: Map<TreeNode, Map<number, Mark[]>>;
  readonly before: Map<TreeNode, Mark[]>;
  readonly after: Map<TreeNode, Mark[]>;
  readonly first: Map<TreeNode, Mark[]>;
  readonly below: Map<TreeNode, Mark[]>;
  readonly above: Map<TreeNode, Mark[]>;
  readonly alone: Map<TreeNode, Mark[]>;
};

function add<Key>(map: Map<Key, Mark[]>, key: Key, mark: Mark): void {
  map.set(key, [...(map.get(key) ?? []), mark]);
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

/**
 * The child holding the offset: at a boundary, the one a superscript follows, and the one a tier pill opens (Story 3.7)
 * when there is one.
 */
function holding(parent: TreeNode, at: number, mark: Mark): TreeNode | undefined {
  const children = parent.children ?? [];
  const opened = mark.kind === 'tier' ? children.find((node) => startOf(node) <= at && at < endOf(node)) : undefined;
  return opened ?? children.find((node) => startOf(node) <= at && at <= endOf(node));
}

/** Records where a mark at the source offset `at` lands, looking from `parent` down. */
function locate(parent: TreeNode, at: number, source: string, mark: Mark, places: Places): void {
  const child = holding(parent, at, mark);
  if (child === undefined) {
    locateBetween(parent, at, source, mark, places);
  } else if (PHRASING.has(parent.type)) {
    locateInline(child, at, source, mark, places);
  } else if (child.type !== 'code' && Array.isArray(child.children)) {
    locate(child, at, source, mark, places);
  } else {
    // A superscript follows the block it cites; a tier pill opens the block its version starts with.
    add(mark.kind === 'tier' ? places.above : places.below, child, mark);
  }
}

/**
 * A mark between `parent`'s children (on a container's syntax): at the end of the child before it, else at the start of
 * an inline parent, else at the start of the child after it, else in a paragraph of its own (an empty container).
 */
function locateBetween(parent: TreeNode, at: number, source: string, mark: Mark, places: Places): void {
  const children = parent.children ?? [];
  const preceding = children.findLast((node) => endOf(node) >= 0 && endOf(node) <= at);
  const following = children.find((node) => startOf(node) >= at);
  if (mark.kind === 'tier' && following !== undefined && (preceding === undefined || !PHRASING.has(parent.type))) {
    // A tier pill opens what follows it: the next block, or the start of an inline parent.
    locate(parent, startOf(following), source, mark, places);
  } else if (preceding !== undefined) {
    locate(parent, endOf(preceding), source, mark, places);
  } else if (PHRASING.has(parent.type)) {
    add(places.first, parent, mark);
  } else if (following !== undefined) {
    locate(parent, startOf(following), source, mark, places);
  } else {
    add(places.alone, parent, mark);
  }
}

/**
 * A mark on an inline `child`: inside its text, before a line break, inside an emphasis (a tier pill at an inline node's
 * start goes before it), else right after the node.
 */
function locateInline(child: TreeNode, at: number, source: string, mark: Mark, places: Places): void {
  if (child.type === 'text') {
    const marks = places.inText.get(child) ?? new Map<number, Mark[]>();
    add(marks, indexIn(child, source, at), mark);
    places.inText.set(child, marks);
  } else if (child.type === 'break' || (mark.kind === 'tier' && at <= startOf(child))) {
    add(places.before, child, mark);
  } else if (INLINE_CONTAINERS.has(child.type)) {
    locate(child, at, source, mark, places);
  } else {
    add(places.after, child, mark);
  }
}

/**
 * Story 3.8: where the line closing a part lands, from the source offset `at` of its end: after the top-level block that
 * holds it (the last one ending at or before it when it falls between blocks), so it stands under the part's last
 * block, before the next tier's pill; in a paragraph of its own when the answer has no block.
 */
function closeAt(root: TreeNode, at: number, mark: Mark, places: Places): void {
  const children = root.children ?? [];
  const block =
    children.findLast((node) => startOf(node) < at && at <= endOf(node)) ?? children.findLast((node) => endOf(node) >= 0 && endOf(node) <= at);
  if (block === undefined) {
    add(places.alone, root, mark);
  } else {
    add(places.below, block, mark);
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

/**
 * A superscript with a visually hidden word ("fonte ") and the number, in the reference's accent; or (Story 3.7) a tier
 * pill: an outlined span with the tier's word, not focusable and with no role of its own, followed by a visually hidden
 * ": " so a reader never runs the word into the text, as `TierLabel` draws it.
 */
function superscripts(marks: readonly Mark[], word: string): TreeNode[] {
  return marks.flatMap((mark): TreeNode[] => {
    if (mark.kind === 'end') {
      return [];
    }
    if (mark.kind === 'citation') {
      return [
        {
          type: 'citation',
          data: {
            hName: 'sup',
            hProperties: { className: [styles.citation] },
            hChildren: [...(word === '' ? [] : [hidden(word)]), { type: 'text', value: String(mark.number) }],
          },
        },
      ];
    }
    // Story 3.8: a pill with a sentence of its own is heard as that sentence, not as its word.
    const pill = { className: [tierStyles.pill, styles.tierInAnswer], dataTier: mark.tier };
    return [
      {
        type: 'tier',
        data: {
          hName: 'span',
          hProperties: mark.spoken === null ? pill : { ...pill, ariaHidden: 'true' },
          hChildren: [{ type: 'text', value: mark.label }],
        },
      },
      {
        type: 'tierSeparator',
        data: {
          hName: 'span',
          hProperties: { className: [tierStyles.separator] },
          hChildren: [{ type: 'text', value: mark.spoken === null ? TIER_SEPARATOR : `${mark.spoken} ` }],
        },
      },
    ];
  });
}

/** A paragraph holding only marks. */
function paragraphOf(marks: readonly Mark[], word: string): TreeNode {
  return { type: 'paragraph', children: superscripts(marks, word) };
}

/**
 * Story 3.8: the muted line that closes the model's own knowledge, as a paragraph of its own: not focusable, with no role
 * of its own, like the pill.
 */
function endLineOf(marks: readonly Mark[]): TreeNode[] {
  return marks.flatMap((mark): TreeNode[] =>
    mark.kind === 'end'
      ? [
          {
            type: 'modelEnd',
            data: { hName: 'p', hProperties: { className: [styles.modelEnd] }, hChildren: [{ type: 'text', value: mark.text }] },
          },
        ]
      : [],
  );
}

/** A text node split at its marks: text, the marks there, text, and so on (no empty text). */
function split(text: TreeNode, marks: Map<number, Mark[]>, word: string): TreeNode[] {
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
    const above = places.above.get(child);
    if (above !== undefined) {
      children.push(paragraphOf(above, word));
    }
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
    const cited = below?.filter((mark) => mark.kind !== 'end') ?? [];
    if (cited.length > 0) {
      children.push(paragraphOf(cited, word));
    }
    children.push(...endLineOf(below ?? []));
  }
  const alone = places.alone.get(parent);
  const marked = alone?.filter((mark) => mark.kind !== 'end') ?? [];
  if (marked.length > 0) {
    children.push(paragraphOf(marked, word));
  }
  children.push(...endLineOf(alone ?? []));
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
function remarkCitations(text: string, marks: readonly CitationMark[], word: string, tiers: readonly TierMark[] = []) {
  return () => (tree: { type: string }) => {
    const points = Array.from(text);
    // The UTF-16 offset of each code-point offset.
    const units = [0];
    for (const point of points) {
      units.push((units.at(-1) ?? 0) + point.length);
    }
    const cited = marks
      .filter((mark) => Number.isInteger(mark.number) && mark.number >= 1)
      .map((mark) => ({ mark: { kind: 'citation', number: mark.number } as Mark, at: units[placeOf(points, mark.offset)] ?? text.length }));
    // A pill at or past the end of the text would open nothing: it is left out.
    const drawn = tiers.filter(
      (mark) => Number.isInteger(mark.offset) && mark.label !== '' && tierPlaceOf(points, mark.offset) < points.length,
    );
    const opened = drawn.map((mark) => ({
      mark: { kind: 'tier', tier: mark.tier, label: mark.label, spoken: mark.spoken ?? null } as Mark,
      at: units[tierPlaceOf(points, mark.offset)] ?? text.length,
    }));

    // At one place, the superscripts of the version that ends come before the pill of the one that starts.
    const placed = [...cited, ...opened].sort((one, other) => one.at - other.at);
    const places: Places = {
      inText: new Map(),
      before: new Map(),
      after: new Map(),
      first: new Map(),
      below: new Map(),
      above: new Map(),
      alone: new Map(),
    };
    for (const { mark, at } of placed) {
      locate(tree as TreeNode, at, text, mark, places);
    }
    // Story 3.8: the line that closes a part with a sentence of its own goes after the block holding its end.
    for (const mark of drawn) {
      if (mark.spoken !== undefined && mark.spoken !== '') {
        const end = units[placeOf(points, mark.end ?? points.length)] ?? text.length;
        closeAt(tree as TreeNode, end, { kind: 'end', text: mark.spoken }, places);
      }
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
  /** Story 3.7: the tier pills of a finished answer, at code-point offsets of `text`, each with its word. */
  readonly tiers?: readonly TierMark[];
};

/**
 * An answer's text as sanitized Markdown (Story 2.4): raw HTML in the text is skipped (`skipHtml`, never rendered),
 * images are dropped, and a link is shown as its words with its address (any address, `addressAsText`), never as an
 * anchor. Nothing is set as HTML.
 * Story 2.5: each mark becomes a superscript with its reference's number at its code-point offset (`remarkCitations`).
 * Story 3.7: each tier mark becomes its tier pill at the start of the version it opens.
 */
export function AnswerMarkdown({ text, linkText, marks = [], citationWord = '', tiers = [] }: AnswerMarkdownProps) {
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
      remarkPlugins={[remarkCitations(text, marks, citationWord, tiers)]}
    >
      {text}
    </Markdown>
  );
}
