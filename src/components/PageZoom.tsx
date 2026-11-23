'use client';

import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
  type UIEvent,
} from 'react';

import { NamedIcon } from './Icons';
import { PageView } from './PageView';
import styles from './PageZoom.module.css';
import { PillButton } from './PillButton';

/** The zoom levels of a picture page, as a share of the size it fits at (2026-11-23): fitted, then up to four times. */
export const ZOOM_LEVELS = [1, 1.5, 2, 3, 4] as const;

type Zoom = { readonly level: number; readonly setLevel: (level: number) => void };

const ZoomContext = createContext<Zoom | null>(null);

/**
 * Keeps one zoom level for every page under it (the pages' layout of the page view), so turning the page, in full
 * screen or not, keeps the level the GM chose.
 */
export function PageZoomProvider({ children }: { readonly children: ReactNode }) {
  const [level, setLevel] = useState<number>(1);
  const zoom = useMemo(() => ({ level, setLevel }), [level]);
  return <ZoomContext.Provider value={zoom}>{children}</ZoomContext.Provider>;
}

/** The zoom level: the provider's, or this component's own where there is none (the source view). */
export function useZoom(): Zoom {
  const shared = useContext(ZoomContext);
  const [level, setLevel] = useState<number>(1);
  return shared ?? { level, setLevel };
}

export type ZoomLabels = {
  readonly group: string;
  readonly zoomIn: string;
  readonly zoomOut: string;
  /** The level as a percentage and what pressing it does, "{percent}, fit the page": it fits the page again. */
  readonly fit: string;
};

/**
 * "−", the level and "+" (2026-11-23). The level reads as a percentage of the fitted size and, pressed, fits the page
 * again. At the ends of `ZOOM_LEVELS` the button that leads nowhere is disabled.
 */
export function ZoomControls({ zoom, labels }: { readonly zoom: Zoom; readonly labels: ZoomLabels }) {
  const index = Math.max(0, ZOOM_LEVELS.findIndex((level) => level === zoom.level));
  const percent = `${Math.round(zoom.level * 100)}%`;
  const fit = labels.fit.replace('{percent}', percent);
  return (
    <div className={styles.controls} role="group" aria-label={labels.group}>
      <PillButton
        variant="quiet"
        aria-label={labels.zoomOut}
        title={labels.zoomOut}
        disabled={index === 0}
        onClick={() => zoom.setLevel(ZOOM_LEVELS[Math.max(0, index - 1)] ?? 1)}
      >
        <NamedIcon name="zoomOut" />
      </PillButton>
      <PillButton variant="quiet" className={styles.level} aria-label={fit} title={fit} onClick={() => zoom.setLevel(1)}>
        <span aria-live="polite">{percent}</span>
      </PillButton>
      <PillButton
        variant="quiet"
        aria-label={labels.zoomIn}
        title={labels.zoomIn}
        disabled={index === ZOOM_LEVELS.length - 1}
        onClick={() => zoom.setLevel(ZOOM_LEVELS[Math.min(ZOOM_LEVELS.length - 1, index + 1)] ?? 1)}
      >
        <NamedIcon name="zoomIn" />
      </PillButton>
    </div>
  );
}

type Size = { readonly width: number; readonly height: number };

/**
 * A fitted picture page that zooms (2026-11-23): at level 1 it is `PageView` as it fits, and its fitted size is
 * measured; above 1 the page is that size times the level, in the room it fitted in, scrolling inside it and keeping
 * the point at the room's centre where it was. The zoom controls float over the bottom of the page, so they take no
 * room of their own; a text page has none. The level is the provider's (the page view) or its own (the source view).
 */
export function ZoomablePage({
  labels,
  ...view
}: Omit<ComponentProps<typeof PageView>, 'zoomed' | 'fit'> & { readonly labels: ZoomLabels }) {
  const zoom = useZoom();
  const { level } = zoom;
  const box = useRef<HTMLDivElement>(null);
  const [fitted, setFitted] = useState<Size | null>(null);
  const centre = useRef<{ x: number; y: number } | null>(null);

  // Whenever the page is drawn at its fitted size (level 1, or a new page or room not measured yet) the stylesheet has
  // fitted it: measure it. At level 1 it is measured again whenever it changes size.
  const atFit = level === 1 || fitted === null;
  useLayoutEffect(() => {
    const svg = box.current?.querySelector('svg');
    if (!atFit || svg === null || svg === undefined) {
      return undefined;
    }
    const measure = () => {
      const { width, height } = svg.getBoundingClientRect();
      if (width > 0 && height > 0) {
        setFitted({ width, height });
      }
    };
    measure();
    if (level !== 1 || typeof ResizeObserver === 'undefined') {
      return undefined;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(svg);
    return () => observer.disconnect();
  }, [atFit, level, view.page]);

  // A zoomed page's room may change size (the window, full screen): forget the fitted size, so it is measured again in
  // the new room before the zoomed page is drawn.
  useLayoutEffect(() => {
    const forget = () => setFitted(null);
    window.addEventListener('resize', forget);
    document.addEventListener('fullscreenchange', forget);
    return () => {
      window.removeEventListener('resize', forget);
      document.removeEventListener('fullscreenchange', forget);
    };
  }, []);

  const zoomed = level > 1 && fitted !== null ? { width: fitted.width * level, height: fitted.height * level } : null;

  // Where the room's centre is in the page, as the GM scrolls; a new size puts that point at the centre again. A page
  // zoomed from its fitted size (never scrolled) is zoomed about its middle.
  const remember = (event: UIEvent<HTMLDivElement>) => {
    const figure = event.target;
    if (figure instanceof HTMLElement && figure.tagName === 'FIGURE' && figure.scrollWidth > 0 && figure.scrollHeight > 0) {
      centre.current = {
        x: (figure.scrollLeft + figure.clientWidth / 2) / figure.scrollWidth,
        y: (figure.scrollTop + figure.clientHeight / 2) / figure.scrollHeight,
      };
    }
  };
  const width = zoomed?.width;
  const height = zoomed?.height;
  useLayoutEffect(() => {
    const figure = box.current?.querySelector('figure');
    if (figure === null || figure === undefined || width === undefined || height === undefined) {
      centre.current = null;
      return;
    }
    const at = centre.current ?? { x: 0.5, y: 0.5 };
    figure.scrollLeft = at.x * figure.scrollWidth - figure.clientWidth / 2;
    figure.scrollTop = at.y * figure.scrollHeight - figure.clientHeight / 2;
  }, [width, height]);

  return (
    <div ref={box} className={styles.box} onScrollCapture={remember}>
      <PageView {...view} fit zoomed={zoomed} />
      {view.page.picture === null ? null : (
        <div className={styles.floating}>
          <ZoomControls zoom={zoom} labels={labels} />
        </div>
      )}
    </div>
  );
}
