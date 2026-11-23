/**
 * How each list is shown (usability pass, 2026-11-21), remembered per browser in `__Host-gmshield-view`: for the files,
 * the campaigns, the systems, (Story 3.10) the conversations of an area and (Story 4.1) a system's record types, a layout (list or grid), a spacing (comfortable or compact), whether thumbnails show
 * and, from the third round, how many rows a page holds. The "Exibição" menu (a client component) writes it, so it is not `HttpOnly`; the server reads it
 * (`currentViews` in `./preferences`), so the first render already has the chosen view and nothing flashes. It holds no
 * content and no identifier; anything off the allowlists is the default.
 */
import { DEFAULT_PAGE_SIZE, PAGE_SIZES, type PageSize } from './paging';

export const VIEW_LISTS = ['files', 'campaigns', 'systems', 'conversations', 'recordTypes'] as const;
export type ViewList = (typeof VIEW_LISTS)[number];
export const VIEW_LAYOUTS = ['list', 'grid'] as const;
export type ViewLayout = (typeof VIEW_LAYOUTS)[number];
export const VIEW_DENSITIES = ['comfortable', 'compact'] as const;
export type ViewDensity = (typeof VIEW_DENSITIES)[number];

export type ListView = { readonly layout: ViewLayout; readonly density: ViewDensity; readonly previews: boolean; readonly size: PageSize };
export type ListViews = Readonly<Record<ViewList, ListView>>;

export const DEFAULT_VIEW: ListView = { layout: 'list', density: 'comfortable', previews: true, size: DEFAULT_PAGE_SIZE };
export const DEFAULT_VIEWS: ListViews = {
  files: DEFAULT_VIEW,
  campaigns: DEFAULT_VIEW,
  systems: DEFAULT_VIEW,
  conversations: DEFAULT_VIEW,
  recordTypes: DEFAULT_VIEW,
};

export const VIEW_COOKIE = '__Host-gmshield-view';
export const VIEW_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

/**
 * The views a cookie value holds: `files:grid:compact:1:20|systems:list:comfortable:0:10`; the default for the rest,
 * and the default page size for a value written before pages had one.
 */
export function viewsFrom(value: unknown): ListViews {
  const views: Record<ViewList, ListView> = { ...DEFAULT_VIEWS };
  if (typeof value !== 'string') {
    return views;
  }
  for (const part of value.split('|').slice(0, VIEW_LISTS.length * 2)) {
    const [name, layoutName, densityName, previews, sizeText] = part.split(':');
    const list = VIEW_LISTS.find((key) => key === name);
    const layout = VIEW_LAYOUTS.find((key) => key === layoutName);
    const density = VIEW_DENSITIES.find((key) => key === densityName);
    if (list !== undefined && layout !== undefined && density !== undefined) {
      const size = PAGE_SIZES.find((value) => String(value) === sizeText) ?? DEFAULT_PAGE_SIZE;
      views[list] = { layout, density, previews: previews !== '0', size };
    }
  }
  return views;
}

/** The value that holds `views`. */
export function viewsValue(views: ListViews): string {
  return VIEW_LISTS.map((list) => {
    const { layout, density, previews, size } = views[list];
    return `${list}:${layout}:${density}:${previews ? '1' : '0'}:${size}`;
  }).join('|');
}

/** The views in a `document.cookie` string. */
export function viewsIn(cookieText: string): ListViews {
  for (const part of cookieText.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === VIEW_COOKIE) {
      return viewsFrom(rest.join('='));
    }
  }
  return DEFAULT_VIEWS;
}

/** The `document.cookie` line that stores the views: `__Host-` needs `Secure`, `Path=/` and no `Domain`. */
export function viewCookieLine(views: ListViews): string {
  return `${VIEW_COOKIE}=${viewsValue(views)}; Path=/; Max-Age=${VIEW_COOKIE_MAX_AGE}; Secure; SameSite=Lax`;
}
