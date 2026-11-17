import { translator, type Language } from '@/messages';
import type { MaterialPageView } from '@/server/materials';

import styles from './PageView.module.css';

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

type Line = MaterialPageView['lines'][number];

/**
 * One line of the text layer: SVG text over its box, in the picture's pixels, its glyphs stretched to the box's width
 * (`textLength`) and transparent by class. Positioned with SVG attributes only: the Content-Security-Policy allows no
 * style attribute.
 */
function TextLine({ line, width, height }: { readonly line: Line; readonly width: number; readonly height: number }) {
  const [left = 0, top = 0, right = 0, bottom = 0] = line.box;
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
 * One page of a material (Story 1.19). A PDF page is one SVG in its picture's pixels: a frame, the picture, and its text
 * lines laid over it as transparent, selectable text that a screen reader reads and that scales with zoom. The frame
 * and the page number show before the picture arrives. A text page is its text as plain text, line breaks kept. Line
 * and page text are React text, never HTML. Story 1.20 shows it beside the extracted text.
 */
export function PageView({
  page,
  materialId,
  language,
}: {
  readonly page: MaterialPageView;
  readonly materialId: string;
  readonly language: Language;
}) {
  const t = translator(language);
  const position = t('pageView.position', { page: page.page, total: page.pageTotal });
  const { picture } = page;
  return (
    <figure className={styles.view} data-kind={picture === null ? 'text' : 'picture'}>
      {picture === null ? (
        <div className={styles.text}>{page.text ?? ''}</div>
      ) : (
        <svg className={styles.page} viewBox={`0 0 ${picture.width} ${picture.height}`} role="group" aria-label={position}>
          <rect className={styles.frame} width={picture.width} height={picture.height} />
          <image href={pictureUrl(materialId, page.page)} width={picture.width} height={picture.height} aria-hidden="true" />
          {page.lines.map((line, index) => (
            <TextLine key={index} line={line} width={picture.width} height={picture.height} />
          ))}
        </svg>
      )}
      <figcaption className={styles.caption}>{position}</figcaption>
    </figure>
  );
}
