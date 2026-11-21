/**
 * The flash message (usability pass, 2026-11-21): what a Server Action that just succeeded has to say ("Sistema
 * criado."), carried to the page that follows in `__Host-gmshield-flash`. The action sets it (`src/server/flash.ts`);
 * the notifications in the browser read it once, show it and clear it, so it is not `HttpOnly`. It lives 30 seconds at
 * most, holds only a status and the text already translated on the server, and never an identifier or a secret.
 */
export const FLASH_COOKIE = '__Host-gmshield-flash';
export const FLASH_COOKIE_MAX_AGE = 30;
/** The longest text carried: a cookie holds about 4 KB, and a name may be all multi-byte characters. */
export const FLASH_MAX_LENGTH = 300;

export const FLASH_STATUSES = ['success', 'warning', 'danger', 'info'] as const;
export type FlashStatus = (typeof FLASH_STATUSES)[number];
export type Flash = { readonly status: FlashStatus; readonly message: string };

/**
 * The cookie's value: the status, a dot, then the text. It is not encoded here: the server's cookie writer
 * percent-encodes a value, and the browser's side (`flashIn`) decodes it once.
 */
export function flashValue({ status, message }: Flash): string {
  return `${status}.${message.slice(0, FLASH_MAX_LENGTH)}`;
}

/** The flash a decoded cookie value carries, or null for anything else. */
export function flashFrom(value: string | undefined): Flash | null {
  if (value === undefined) {
    return null;
  }
  const dot = value.indexOf('.');
  const status = FLASH_STATUSES.find((name) => name === value.slice(0, dot));
  if (dot < 0 || status === undefined) {
    return null;
  }
  const message = value.slice(dot + 1, dot + 1 + FLASH_MAX_LENGTH);
  return message.trim() === '' ? null : { status, message };
}

/** The flash in a `document.cookie` string (its value percent-encoded, as the server wrote it), or null. */
export function flashIn(cookieText: string): Flash | null {
  for (const part of cookieText.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === FLASH_COOKIE) {
      try {
        return flashFrom(decodeURIComponent(rest.join('=')));
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** The `document.cookie` line that clears it: `__Host-` needs `Secure`, `Path=/` and no `Domain`. */
export function flashClearLine(): string {
  return `${FLASH_COOKIE}=; Path=/; Max-Age=0; Secure; SameSite=Lax`;
}
