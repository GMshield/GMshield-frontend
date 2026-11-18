import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

/**
 * WCAG 2.1 AA contrast of the design tokens, read from src/app/styles/tokens.css, and the rules
 * every stylesheet keeps (roles only, the focus ring, no shadows, nothing from another host).
 */
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TOKENS = readFileSync(join(ROOT, 'src/app/styles/tokens.css'), 'utf8');
const GLOBALS = readFileSync(join(ROOT, 'src/app/globals.css'), 'utf8');
const BACKDROP = join(ROOT, 'src/app/assets/backdrop.webp');
const THEMES = ['dark', 'light', 'illustrated'] as const;
type Theme = (typeof THEMES)[number];
const AA = 4.5;
/** Non-text contrast (WCAG 1.4.11), for the focus ring the accent draws on the page. */
const NON_TEXT = 3;

type Rgb = readonly [number, number, number];
type Rgba = readonly [number, number, number, number];

/** The declarations of the first top-level block whose selector is exactly `selector`. */
function block(selector: string): Map<string, string> {
  const start = TOKENS.indexOf(`\n${selector} {\n`);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  const body = TOKENS.slice(start, TOKENS.indexOf('\n}', start));
  return new Map([...body.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)].map((match) => [match[1] ?? '', (match[2] ?? '').trim()]));
}

const PRIMITIVES = block(':root');
const ROLES = new Map(THEMES.map((theme) => [theme, block(`:root[data-theme='${theme}']`)]));

function hex(value: string): Rgb {
  const match = /^#([0-9a-f]{6})$/i.exec(value);
  if (match?.[1] === undefined) {
    throw new Error(`Not a #rrggbb colour: ${value}`);
  }
  const n = Number.parseInt(match[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function primitive(reference: string): Rgb {
  const name = /^var\((--[\w-]+)\)$/.exec(reference)?.[1];
  const value = name === undefined ? undefined : PRIMITIVES.get(name);
  if (value === undefined) {
    throw new Error(`Not a primitive: ${reference}`);
  }
  return hex(value);
}

/** A role's colour: a primitive, `transparent`, or a primitive mixed with transparent at N%. */
function resolve(value: string): Rgba {
  if (value === 'transparent') {
    return [0, 0, 0, 0];
  }
  const mix = /^color-mix\(in srgb, (var\(--[\w-]+\)) (\d+(?:\.\d+)?)%, transparent\)$/.exec(value);
  if (mix?.[1] !== undefined && mix[2] !== undefined) {
    return [...primitive(mix[1]), Number(mix[2]) / 100];
  }
  return [...primitive(value), 1];
}

function role(theme: Theme, name: string): Rgba {
  const value = ROLES.get(theme)?.get(`--color-${name}`);
  if (value === undefined) {
    throw new Error(`${theme} has no --color-${name}`);
  }
  return resolve(value);
}

function over(top: Rgba, bottom: Rgb): Rgb {
  const [r, g, b, a] = top;
  return [r * a + bottom[0] * (1 - a), g * a + bottom[1] * (1 - a), b * a + bottom[2] * (1 - a)];
}

function luminance([r, g, b]: Rgb): number {
  const linear = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function ratio(a: Rgb, b: Rgb): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

function opaque(colour: Rgba): Rgb {
  expect(colour[3], 'an opaque colour').toBe(1);
  return [colour[0], colour[1], colour[2]];
}

/**
 * Every pair that carries text (or the light theme's field outline) in one theme, over `page`:
 * the colour the canvas shows. In the illustrated theme that is the scrim over the backdrop.
 */
function pairs(theme: Theme, page: Rgb): [string, Rgb, Rgb][] {
  const text = opaque(role(theme, 'text'));
  const muted = opaque(role(theme, 'text-muted'));
  const surface = over(role(theme, 'surface'), page);
  const dialog = over(role(theme, 'surface'), over(role(theme, 'dim'), page));
  const list: [string, Rgb, Rgb][] = [
    ['text on canvas', text, page],
    ['muted text on canvas', muted, page],
    ['text on surface', text, surface],
    ['muted text on surface', muted, surface],
    ['accent on surface', opaque(role(theme, 'accent')), surface],
    ['text on active row', text, over(role(theme, 'surface-active'), surface)],
    ['text in field', text, over(role(theme, 'field'), page)],
    ['text on dialog over the dimmed canvas', text, dialog],
    ['pill text on canvas', text, over(role(theme, 'control'), page)],
    ['pill text on surface', text, over(role(theme, 'control'), surface)],
    ['solid pill', opaque(role(theme, 'on-solid')), opaque(role(theme, 'solid'))],
    ['danger pill', opaque(role(theme, 'on-status')), opaque(role(theme, 'danger'))],
  ];
  for (const status of ['danger', 'warning', 'success']) {
    list.push([`${status} on surface`, opaque(role(theme, status)), surface]);
    list.push([`${status} on dialog`, opaque(role(theme, status)), dialog]);
  }
  const fieldBorder = role(theme, 'field-border');
  if (fieldBorder[3] > 0) {
    list.push(['field outline on canvas', opaque(fieldBorder), page]);
  }
  return list;
}

function expectAA(theme: Theme, page: Rgb) {
  for (const [name, foreground, background] of pairs(theme, page)) {
    expect(ratio(foreground, background), `${theme}: ${name}`).toBeGreaterThanOrEqual(AA);
  }
  // The focus ring sits outside its control (outline-offset), on the canvas itself.
  expect(ratio(opaque(role(theme, 'accent')), page), `${theme}: accent on canvas`).toBeGreaterThanOrEqual(NON_TEXT);
}

/** The canvas the illustrated theme shows: the scrim over one backdrop pixel (opaque). */
function illustratedPage(pixel: Rgb): Rgb {
  return over(role('illustrated', 'scrim'), pixel);
}

describe('contrast (WCAG 2.1 AA, 4.5:1)', () => {
  it('defines every role in every theme', () => {
    const names = [...(ROLES.get('dark')?.keys() ?? [])].sort();
    expect(names.length).toBeGreaterThan(20);
    for (const theme of THEMES) {
      expect([...(ROLES.get(theme)?.keys() ?? [])].filter((name) => name.startsWith('--color-')).sort(), theme).toEqual(
        names.filter((name) => name.startsWith('--color-')),
      );
      for (const name of names.filter((n) => n.startsWith('--color-'))) {
        expect(() => role(theme, name.slice('--color-'.length)), `${theme} ${name}`).not.toThrow();
      }
    }
  });

  it('matches the pairs DESIGN.md measured', () => {
    const p = (name: string) => hex(PRIMITIVES.get(`--${name}`) ?? '');
    const measured: [string, string, number][] = [
      ['dark-text', 'dark-canvas', 18.7],
      ['dark-text-muted', 'dark-surface', 8.1],
      ['dark-accent', 'dark-surface', 8.0],
      ['light-text', 'light-canvas', 20.1],
      ['light-text-muted', 'light-surface', 7.4],
      ['light-accent', 'light-surface', 6.0],
      ['light-field-border', 'light-canvas', 5.1],
    ];
    for (const [foreground, background, expected] of measured) {
      expect(ratio(p(foreground), p(background)), `${foreground} on ${background}`).toBeCloseTo(expected, 0);
    }
  });

  it('dark and light: every text pair, status colour and pill', () => {
    expectAA('dark', opaque(role('dark', 'canvas')));
    expectAA('light', opaque(role('light', 'canvas')));
  });

  it('illustrated, before the backdrop loads: the scrim over the canvas colour', () => {
    expectAA('illustrated', illustratedPage(opaque(role('illustrated', 'canvas'))));
  });

  // The scrim is uniform and sized by the brightest pixel of the whole backdrop: any crop at any
  // width (1280, 1024 or 390 pixels) is at most that bright, and resampling never makes a pixel
  // brighter than the brightest one, so this one check covers every viewport.
  it('illustrated: the brightest backdrop pixel, under the scrim and under the glass', async () => {
    expect(existsSync(BACKDROP), 'src/app/assets/backdrop.webp').toBe(true);
    expect(GLOBALS).toMatch(/background-image: linear-gradient\(var\(--color-scrim\), var\(--color-scrim\)\), url\('\.\/assets\/backdrop\.webp'\);/);
    const { data, info } = await sharp(BACKDROP).flatten({ background: '#1a0a05' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(info.channels).toBe(3);
    // The worst pixel is the brightest one after the scrim, the colour text actually sits on.
    let worst = illustratedPage([0, 0, 0]);
    for (let i = 0; i + 2 < data.length; i += 3) {
      const page = illustratedPage([data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0]);
      if (luminance(page) > luminance(worst)) {
        worst = page;
      }
    }
    expectAA('illustrated', worst);
  });

  it('sharp loads (it measures the backdrop)', async () => {
    const { info } = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#ffffff' } }).raw().toBuffer({ resolveWithObject: true });
    expect(info.width).toBe(2);
  });

  it('reduced motion turns sliding off', () => {
    expect(PRIMITIVES.get('--motion-slide')).toMatch(/^\d+ms$/);
    expect(GLOBALS).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*:root \{\s*--motion-slide: 0ms;\s*\}\s*\}/);
  });
});

function files(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

const SOURCES = files(join(ROOT, 'src')).filter((path) => !path.includes('/generated/'));
const STYLESHEETS = SOURCES.filter((path) => path.endsWith('.css'));

describe('stylesheets', () => {
  it('draw the focus ring with the accent, and nothing removes it', () => {
    expect(GLOBALS).toMatch(/:focus-visible \{\s*outline: 2px solid var\(--color-accent\);\s*outline-offset: 2px;\s*\}/);
    for (const path of STYLESHEETS) {
      expect(readFileSync(path, 'utf8'), relative(ROOT, path)).not.toMatch(/outline(-width|-style)?:\s*(none|0)\b/);
    }
  });

  it('use roles only: hex values and primitives stay in tokens.css', () => {
    for (const path of STYLESHEETS.filter((p) => !p.endsWith('/styles/tokens.css'))) {
      const css = readFileSync(path, 'utf8');
      expect(css, relative(ROOT, path)).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
      expect(css, relative(ROOT, path)).not.toMatch(/var\(--(dark|light|illustrated|landing)-/);
    }
  });

  it('never use shadows or the accent as a fill', () => {
    for (const path of STYLESHEETS) {
      const css = readFileSync(path, 'utf8');
      expect(css, relative(ROOT, path)).not.toMatch(/box-shadow|text-shadow|drop-shadow/);
      expect(css, relative(ROOT, path)).not.toMatch(/background(-color)?:[^;]*--color-accent/);
    }
  });

  it('load nothing from another host', () => {
    for (const path of STYLESHEETS) {
      expect(readFileSync(path, 'utf8'), relative(ROOT, path)).not.toMatch(/url\(\s*['"]?(https?:)?\/\/|@import\s+url\(\s*['"]?(https?:)?\/\//);
    }
  });

  it('no component sets a style attribute (the CSP blocks them)', () => {
    for (const path of SOURCES.filter((p) => p.endsWith('.tsx'))) {
      expect(readFileSync(path, 'utf8'), relative(ROOT, path)).not.toMatch(/\bstyle=/);
    }
  });

  it('gives every control a hit area of at least 44px', () => {
    const rules = (file: string) => readFileSync(join(ROOT, 'src', file), 'utf8');
    const hitArea = (css: string, selector: string) => {
      const body = new RegExp(`^${selector.replace('.', '\\.')} \\{([^}]*)\\}`, 'm').exec(css)?.[1] ?? '';
      return body;
    };
    for (const [file, selector] of [
      ['components/PillButton.module.css', '.pill'],
      ['components/Notice.module.css', '.link'],
      ['components/PreferencesForm.module.css', '.option'],
      ['app/page.module.css', '.link'],
      // Story 1.11: the shell's controls.
      ['components/Sidebar.module.css', '.entry'],
      ['components/Sidebar.module.css', '.add'],
      ['components/LogoMenu.module.css', '.trigger'],
      ['components/ContextBar.module.css', '.link'],
      ['components/ContextBar.module.css', '.bar'],
    ] as const) {
      const body = hitArea(rules(file), selector);
      expect(body, `${file} ${selector}`).toMatch(/min-height: var\(--space-touch-target\)/);
    }
    const dismiss = hitArea(rules('components/Notice.module.css'), '.dismiss');
    expect(dismiss).toMatch(/width: var\(--space-touch-target\)/);
    expect(dismiss).toMatch(/height: var\(--space-touch-target\)/);
    // The sidebar's collapse control and handle (icon only): 44px both ways at least.
    const iconControls = /^\.collapse,\n\.handle \{([^}]*)\}/m.exec(rules('components/Sidebar.module.css'))?.[1] ?? '';
    expect(iconControls).toMatch(/width: var\(--space-touch-target\)/);
    expect(iconControls).toMatch(/height: var\(--space-touch-target\)/);
    expect(PRIMITIVES.get('--space-touch-target')).toBe('44px');
  });
});
