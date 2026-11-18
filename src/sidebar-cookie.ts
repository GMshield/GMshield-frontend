/**
 * The sidebar's state on a wide screen (Story 1.11), remembered per browser: `__Host-gmshield-sidebar`, `open`
 * or `closed`, for a year. The sidebar (a client component) writes it, so it is not `HttpOnly`; the server
 * reads it (`currentSidebar` in `./preferences`), so the first render already has the right state and nothing
 * flashes. Anything but `closed` is open. It holds no content and no identifier.
 */
export const SIDEBAR_STATES = ['open', 'closed'] as const;
export type SidebarState = (typeof SIDEBAR_STATES)[number];
export const SIDEBAR_COOKIE = '__Host-gmshield-sidebar';
export const SIDEBAR_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

export function sidebarFrom(value: unknown): SidebarState {
  return value === 'closed' ? 'closed' : 'open';
}

/** The `document.cookie` line that stores the state: `__Host-` needs `Secure`, `Path=/` and no `Domain`. */
export function sidebarCookieLine(state: SidebarState): string {
  return `${SIDEBAR_COOKIE}=${state}; Path=/; Max-Age=${SIDEBAR_COOKIE_MAX_AGE}; Secure; SameSite=Lax`;
}
