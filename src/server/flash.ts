import 'server-only';

import { cookies } from 'next/headers';

import { FLASH_COOKIE, FLASH_COOKIE_MAX_AGE, flashValue, type FlashStatus } from '@/flash-cookie';

/**
 * Says what a Server Action just did, on the page that follows it (usability pass, 2026-11-21): the notifications show
 * it as a toast and keep it in their list. Call it once the backend has answered, before a `redirect` or a `refresh`.
 * The text is already in the interface's language. Server Actions only: a page cannot set a cookie.
 */
export async function flash(status: FlashStatus, message: string): Promise<void> {
  (await cookies()).set(FLASH_COOKIE, flashValue({ status, message }), {
    secure: true,
    httpOnly: false,
    sameSite: 'lax',
    path: '/',
    maxAge: FLASH_COOKIE_MAX_AGE,
  });
}
