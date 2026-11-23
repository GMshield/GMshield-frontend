/**
 * The page view's full screen and the selection on a page picture (2026-11-23, outside any story): the frame that goes
 * full screen, its header control, the arrow keys that turn the page while it is on, and the translucent highlight
 * that keeps the selected lines of a picture visible.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const pushed: string[] = [];
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ refresh: () => undefined, push: (href: string) => pushed.push(href), replace: () => undefined, prefetch: () => undefined }),
}));

const { FullScreenButton, FullScreenFrame } = await import('@/components/FullScreen');

const PREVIOUS = '/files/m/pages/12';
const NEXT = '/files/m/pages/14';

/** jsdom has no full screen: the smallest stand-in, which tells `fullscreenchange` as a browser does. */
function fakeFullScreen(enabled: boolean) {
  let current: Element | null = null;
  Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, get: () => enabled });
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => current });
  const request = vi.fn(function requestFullscreen(this: Element) {
    current = this as Element; // the element asked is the one in full screen
    document.dispatchEvent(new Event('fullscreenchange'));
    return Promise.resolve();
  });
  const exit = vi.fn(() => {
    current = null;
    document.dispatchEvent(new Event('fullscreenchange'));
    return Promise.resolve();
  });
  Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', { configurable: true, value: request });
  Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exit });
  return { request, exit };
}

function view({ previous = PREVIOUS, next = NEXT }: { previous?: string | null; next?: string | null } = {}) {
  return render(
    <FullScreenFrame>
      <header>
        <FullScreenButton enter="Tela cheia" leave="Sair da tela cheia" previous={previous} next={next} />
        <input aria-label="Ir para a página" type="number" />
      </header>
      <p>página</p>
    </FullScreenFrame>,
  );
}

beforeEach(() => {
  pushed.length = 0;
});

afterEach(() => {
  cleanup();
});

describe('the page view in full screen', () => {
  it('puts the frame, and only the frame, in full screen, and leaves it from the same control', async () => {
    const { request, exit } = fakeFullScreen(true);
    const { container } = view();
    const frame = container.firstElementChild as HTMLElement;
    await userEvent.click(screen.getByRole('button', { name: 'Tela cheia' }));
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.contexts[0]).toBe(frame);
    expect(frame.dataset['fullscreen']).toBe('on');
    await userEvent.click(screen.getByRole('button', { name: 'Sair da tela cheia' }));
    expect(exit).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Tela cheia' })).toBeTruthy();
    expect(frame.dataset['fullscreen']).toBeUndefined();
  });

  it('shows no control where the browser offers no full screen', () => {
    fakeFullScreen(false);
    view();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows no control outside a frame', () => {
    fakeFullScreen(true);
    render(<FullScreenButton enter="Full screen" leave="Exit full screen" previous={PREVIOUS} next={NEXT} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('turns the page with the arrow keys while on, and only then', async () => {
    fakeFullScreen(true);
    view();
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    expect(pushed).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'Tela cheia' }));
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    expect(pushed).toEqual([NEXT, PREVIOUS]);
  });

  it('leaves the arrow keys to a field and to a key with a modifier', async () => {
    fakeFullScreen(true);
    view();
    await userEvent.click(screen.getByRole('button', { name: 'Tela cheia' }));
    fireEvent.keyDown(screen.getByRole('spinbutton', { name: 'Ir para a página' }), { key: 'ArrowRight' });
    fireEvent.keyDown(document.body, { key: 'ArrowLeft', altKey: true });
    expect(pushed).toEqual([]);
  });

  it('does nothing past the first and the last page', async () => {
    fakeFullScreen(true);
    view({ previous: null, next: null });
    await userEvent.click(screen.getByRole('button', { name: 'Tela cheia' }));
    act(() => {
      fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
      fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    });
    expect(pushed).toEqual([]);
  });

  it('is no box outside full screen, and the whole screen in the canvas colour in it', () => {
    const css = readFileSync(join(process.cwd(), 'src/components/FullScreen.module.css'), 'utf8');
    expect(css).toMatch(/\.frame \{\s*display: contents;\s*\}/);
    const on = /\.frame:fullscreen \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(on).toMatch(/display: flex;/);
    expect(on).toMatch(/overflow-y: auto;/);
    expect(on).toMatch(/background-color: var\(--color-canvas\);/);
  });
});

describe('text selected on a page picture', () => {
  it('is a translucent highlight, never the theme’s solid selection over the picture', () => {
    const css = readFileSync(join(process.cwd(), 'src/components/PageView.module.css'), 'utf8');
    expect(css).toMatch(/\.line::selection \{\s*background-color: var\(--color-page-selection\);\s*\}/);
    const tokens = readFileSync(join(process.cwd(), 'src/app/styles/tokens.css'), 'utf8');
    expect(tokens).toMatch(/--paper-selection: #[0-9a-f]{6};/);
    for (const theme of ['dark', 'light', 'illustrated']) {
      const block = new RegExp(`:root\\[data-theme='${theme}'\\] \\{([^}]*)\\}`).exec(tokens)?.[1] ?? '';
      expect(block, theme).toMatch(/--color-page-selection: color-mix\(in srgb, var\(--paper-selection\) \d+%, transparent\);/);
    }
  });
});
