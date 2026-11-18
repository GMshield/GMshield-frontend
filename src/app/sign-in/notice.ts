/**
 * The sign-in outcomes that travel in the query string of `/` (`?signIn=<code>`) after a redirect. Only
 * these codes are ever shown; anything else in the query is ignored, so the URL cannot put text on the page.
 */
export const SIGN_IN_NOTICES = [
  'request.sign_in_expired',
  'request.sign_in_refused',
  'session.required',
  'integrity.failed',
  'server.unavailable',
  'server.unexpected',
] as const;
export type SignInNotice = (typeof SIGN_IN_NOTICES)[number];

export function signInNoticeFrom(value: unknown): SignInNotice | null {
  return SIGN_IN_NOTICES.find((code) => code === value) ?? null;
}

/** The notice for a problem detail's code; anything unknown is `server.unexpected`. */
export function signInNoticeFor(code: string | null): SignInNotice {
  return signInNoticeFrom(code) ?? 'server.unexpected';
}

export function homeWithNotice(notice: SignInNotice): string {
  return `/?signIn=${encodeURIComponent(notice)}`;
}
