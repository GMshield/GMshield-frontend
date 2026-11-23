/**
 * A picture page's zoom (2026-11-23, outside any story): the "−", level and "+" controls, the zoomed page's size from
 * its fitted one, the level kept by a provider across pages, and a text page with no controls.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { components } from '@/server/backend/generated/public';

const { PageZoomProvider, ZOOM_LEVELS, ZoomablePage } = await import('@/components/PageZoom');

type Page = components['schemas']['MaterialPageView'];

const LABELS = { group: 'Zoom', zoomIn: 'Zoom in', zoomOut: 'Zoom out', fit: '{percent}, fit the page' };

const picturePage = {
  page: 13,
  pageTotal: 364,
  picture: { width: 1545, height: 2000 },
  lines: [{ text: 'Armor', box: [0.1, 0.1, 0.5, 0.12] }],
  text: null,
  passages: [],
  outcome: 'read_directly',
} as unknown as Page;

/** jsdom lays nothing out: every SVG is drawn at this fitted size. */
const FITTED = { width: 400, height: 518 };

beforeEach(() => {
  vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockReturnValue({
    ...FITTED,
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: FITTED.width,
    bottom: FITTED.height,
    toJSON: () => ({}),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function svgSize(container: HTMLElement): [string | null, string | null] {
  const svg = container.querySelector('figure svg');
  return [svg?.getAttribute('width') ?? null, svg?.getAttribute('height') ?? null];
}

describe('a picture page zooms', () => {
  it('fits at 100%, then grows by the levels to 400%, with "−" and "+" disabled at the ends', async () => {
    expect(ZOOM_LEVELS).toEqual([1, 1.5, 2, 3, 4]);
    const { container } = render(<ZoomablePage page={picturePage} pictureSrc="/p.png" language="en" labels={LABELS} />);
    const figure = container.querySelector('figure');
    expect(figure?.hasAttribute('data-zoomed')).toBe(false);
    expect(screen.getByRole('group', { name: 'Zoom' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Zoom out' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: '100%, fit the page' })).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(screen.getByRole('button', { name: '150%, fit the page' })).toBeTruthy();
    expect(container.querySelector('figure')?.hasAttribute('data-zoomed')).toBe(true);
    expect(svgSize(container)).toEqual(['600', '777']);

    for (let i = 0; i < 3; i += 1) {
      await userEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    }
    expect(svgSize(container)).toEqual(['1600', '2072']);
    expect(screen.getByRole('button', { name: 'Zoom in' }).hasAttribute('disabled')).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: '400%, fit the page' }));
    expect(container.querySelector('figure')?.hasAttribute('data-zoomed')).toBe(false);
    expect(screen.getByRole('button', { name: '100%, fit the page' })).toBeTruthy();
  });

  it('keeps the level of its provider for the next page', async () => {
    const { rerender, container } = render(
      <PageZoomProvider>
        <ZoomablePage key={13} page={picturePage} pictureSrc="/p13.png" language="en" labels={LABELS} />
      </PageZoomProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    await userEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    rerender(
      <PageZoomProvider>
        <ZoomablePage key={14} page={{ ...picturePage, page: 14 }} pictureSrc="/p14.png" language="en" labels={LABELS} />
      </PageZoomProvider>,
    );
    expect(screen.getByRole('button', { name: '200%, fit the page' })).toBeTruthy();
    expect(svgSize(container)).toEqual(['800', '1036']);
  });

  it('shows no zoom on a text page', () => {
    const textPage = { ...picturePage, picture: null, lines: [], text: 'Plain text.' } as unknown as Page;
    render(<ZoomablePage page={textPage} pictureSrc="/p.png" language="en" labels={LABELS} />);
    expect(screen.queryByRole('group', { name: 'Zoom' })).toBeNull();
    expect(screen.getByText('Plain text.')).toBeTruthy();
  });

  it('scrolls a zoomed page inside the room it fitted in', () => {
    const css = readFileSync(join(process.cwd(), 'src/components/PageView.module.css'), 'utf8');
    const room = /\.view\[data-zoomed\] \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(room).toMatch(/height: var\(--page-height, auto\);/);
    expect(room).toMatch(/overflow: auto;/);
    expect(css).toMatch(/\.view\[data-zoomed\] \.page \{[^}]*max-width: none;[^}]*max-height: none;/);
  });
});
