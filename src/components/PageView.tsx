import { Fragment, type ReactNode } from 'react';

import { translator, type Language } from '@/messages';
import type { components } from '@/server/backend/generated/public';

import styles from './PageView.module.css';

/** A page as the backend answers it: a material's page on the review ground, or a page a reference names (Story 2.7). */
type Page = components['schemas']['MaterialPageView'];

/** The least a fitted page's own size is on its shorter side, in pixels: more than any screen shows it at. */
const FIT_SIZE = 4000;

/** Share of a line's box height taken as its font size, and where its baseline sits from the box's top. */
const FONT_SHARE = 0.9;
const BASELINE_SHARE = 0.8;

/** The picture of a page on a ground, through this site's relay (`src/app/api/v1/materials/[id]/pages/[page]/picture`). */
export function pictureUrl(materialId: string, page: number, ground = 'review'): string {
  return `/api/v1/materials/${encodeURIComponent(materialId)}/pages/${page}/picture?ground=${ground}`;
}

function rounded(value: number): number {
  return Math.round(value * 10) / 10;
}

type Line = Page['lines'][number];
type Box = readonly [left: number, top: number, right: number, bottom: number];

function boxOf(values: readonly number[]): Box {
  const [left = 0, top = 0, right = 0, bottom = 0] = values;
  return [left, top, right, bottom];
}

/** Whether a line falls within a box: its centre lies inside it. */
function within(line: Line, box: Box): boolean {
  const [left, top, right, bottom] = boxOf(line.box);
  const x = (left + right) / 2;
  const y = (top + bottom) / 2;
  return x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3];
}

/**
 * One line of the text layer: SVG text over its box, in the picture's pixels, its glyphs stretched to the box's width
 * (`textLength`) and transparent by class. Positioned with SVG attributes only: the Content-Security-Policy allows no
 * style attribute.
 */
function TextLine({ line, width, height }: { readonly line: Line; readonly width: number; readonly height: number }) {
  const [left, top, right, bottom] = boxOf(line.box);
  const boxHeight = Math.max((bottom - top) * height, 1);
  const boxWidth = (right - left) * width;
  return (
    <text
      x={rounded(left * width)}
      y={rounded(top * height + boxHeight * BASELINE_SHARE)}
      fontSize={rounded(boxHeight * FONT_SHARE)}
      textLength={boxWidth > 0 ? rounded(boxWidth) : undefined}
      lengthAdjust={boxWidth > 0 ? 'spacingAndGlyphs' : undefined}
      className={styles.line}
    >
      {line.text}
    </text>
  );
}

/**
 * The text layer in reading order (Story 2.7): each run of consecutive lines that fall within a cited box sits in a
 * group announced as the cited passage; the other lines stand alone.
 */
function TextLayer({ lines, boxes, width, height, label }: {
  readonly lines: readonly Line[];
  readonly boxes: readonly Box[];
  readonly width: number;
  readonly height: number;
  readonly label: string;
}) {
  const runs: { readonly cited: boolean; readonly lines: { readonly line: Line; readonly index: number }[] }[] = [];
  lines.forEach((line, index) => {
    const cited = boxes.some((box) => within(line, box));
    const last = runs.at(-1);
    if (last !== undefined && last.cited && cited) {
      last.lines.push({ line, index });
    } else {
      runs.push({ cited, lines: [{ line, index }] });
    }
  });
  return runs.map((run) => {
    const drawn = run.lines.map(({ line, index }) => <TextLine key={index} line={line} width={width} height={height} />);
    const first = run.lines[0]?.index ?? 0;
    return run.cited ? (
      <g key={`cited-${first}`} role="group" aria-label={label}>
        {drawn}
      </g>
    ) : (
      <Fragment key={`line-${first}`}>{drawn}</Fragment>
    );
  });
}

/**
 * A text page's text with the code-point ranges of its cited passages marked (Story 2.7): each merged range is a
 * `<mark>` in a group announced as the cited passage. Code points, as the backend counts them (`Array.from`).
 */
function markedText(text: string, ranges: readonly (readonly [number, number])[], label: string): ReactNode {
  if (ranges.length === 0) {
    return text;
  }
  const points = Array.from(text);
  const merged: [number, number][] = [];
  for (const [start, end] of [...ranges].sort((a, b) => a[0] - b[0])) {
    const from = Math.max(0, Math.min(start, points.length));
    const to = Math.max(from, Math.min(end, points.length));
    const last = merged.at(-1);
    if (last !== undefined && from <= last[1]) {
      last[1] = Math.max(last[1], to);
    } else if (to > from) {
      merged.push([from, to]);
    }
  }
  const parts: ReactNode[] = [];
  let at = 0;
  for (const [from, to] of merged) {
    if (from > at) {
      parts.push(points.slice(at, from).join(''));
    }
    parts.push(
      <span key={from} role="group" aria-label={label}>
        <mark className={styles.mark} data-cited="">
          {points.slice(from, to).join('')}
        </mark>
      </span>,
    );
    at = to;
  }
  if (at < points.length) {
    parts.push(points.slice(at).join(''));
  }
  return parts;
}

/**
 * One page of a material (Story 1.19). A PDF page is one SVG in its picture's pixels: a frame, the picture, and its text
 * lines laid over it as transparent, selectable text that a screen reader reads and that scales with zoom. The frame
 * and the page number show before the picture arrives. A text page is its text as plain text, line breaks kept. Line
 * and page text are React text, never HTML. Story 1.20 shows it beside the extracted text.
 *
 * Story 2.7: the picture's address is given (a material's page on the review ground, or a page a reference names), and
 * `cited` names the passages to mark. On a picture page each box of a cited passage is a rect under the translucent
 * passage mark, and the lines within a cited box sit in a group announced as "trecho citado"; on a text page each
 * cited passage's range is a `<mark>` announced the same way. A page without a cited passage marks nothing. The
 * source view, which shows "p. N" itself, leaves out the "Page N of M" caption (`caption={false}`). The page view
 * shows a picture page at the height of the window (`fit`).
 */
export function PageView({
  page,
  pictureSrc,
  language,
  cited = [],
  caption = true,
  fit = false,
  zoomed = null,
}: {
  readonly page: Page;
  readonly pictureSrc: string;
  readonly language: Language;
  readonly cited?: readonly string[];
  readonly caption?: boolean;
  /**
   * Whether a picture page fits the room its screen gives it: no wider than its column and no taller than
   * `--page-height`, keeping its shape. Without it the page is as wide as its column, whatever its height.
   */
  readonly fit?: boolean;
  /**
   * A zoomed picture page's size in CSS pixels (2026-11-23, `ZoomablePage`), or null at the size `fit` gives it. A
   * zoomed page keeps the room it had and scrolls inside it.
   */
  readonly zoomed?: { readonly width: number; readonly height: number } | null;
}) {
  const t = translator(language);
  const position = t('pageView.position', { page: page.page, total: page.pageTotal });
  const label = t('pageView.citedPassage');
  const marked = page.passages.filter((passage) => cited.includes(passage.id));
  const { picture } = page;
  if (picture === null) {
    const ranges = marked.flatMap((passage) => {
      const [start, end] = passage.range ?? [];
      return start === undefined || end === undefined ? [] : [[start, end] as const];
    });
    return (
      <figure className={styles.view} data-kind="text">
        <div className={styles.text}>{markedText(page.text ?? '', ranges, label)}</div>
        {caption ? <figcaption className={styles.caption}>{position}</figcaption> : null}
      </figure>
    );
  }
  const boxes = marked.flatMap((passage) => (passage.boxes ?? []).map(boxOf));
  // A page that fits its room is sized like a picture: the SVG gets a size of its own, in the picture's shape and larger
  // than any screen, and the stylesheet's two limits (the column's width, the room's height) bring it down to the
  // largest size that keeps the shape. Attributes, not a style: the Content-Security-Policy allows no style attribute.
  const grown = fit ? Math.ceil(FIT_SIZE / Math.max(Math.min(picture.width, picture.height), 1)) : 0;
  let size: { width?: number; height?: number } = fit ? { width: picture.width * grown, height: picture.height * grown } : {};
  if (zoomed !== null) {
    size = { width: Math.round(zoomed.width), height: Math.round(zoomed.height) };
  }
  return (
    <figure className={styles.view} data-kind="picture" data-fit={fit ? 'room' : undefined} data-zoomed={zoomed === null ? undefined : ''}>
      <svg className={styles.page} viewBox={`0 0 ${picture.width} ${picture.height}`} role="group" aria-label={position} {...size}>
        <rect className={styles.frame} width={picture.width} height={picture.height} />
        <image href={pictureSrc} width={picture.width} height={picture.height} aria-hidden="true" />
        {boxes.map(([left, top, right, bottom], index) => (
          <rect
            key={`mark-${index}`}
            className={styles.passage}
            data-cited=""
            x={rounded(left * picture.width)}
            y={rounded(top * picture.height)}
            width={rounded(Math.max(right - left, 0) * picture.width)}
            height={rounded(Math.max(bottom - top, 0) * picture.height)}
            aria-hidden="true"
          />
        ))}
        <TextLayer lines={page.lines} boxes={boxes} width={picture.width} height={picture.height} label={label} />
      </svg>
      {caption ? <figcaption className={styles.caption}>{position}</figcaption> : null}
    </figure>
  );
}
