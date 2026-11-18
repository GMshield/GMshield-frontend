'use server';

import { refresh } from 'next/cache';

import type { MaterialActionState } from '@/components/MaterialActions';
import { errorText } from '@/messages';
import { currentPreferences } from '@/preferences';
import { actOnMaterial, MATERIAL_ACTIONS, type MaterialAction } from '@/server/materials';
import { currentSessionToken } from '@/server/session-cookies';

/** A material's id as the backend mints it; anything else is a material nowhere. */
const ID = /^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$/;

function isAction(value: unknown): value is MaterialAction {
  return typeof value === 'string' && (MATERIAL_ACTIONS as readonly string[]).includes(value);
}

/**
 * The GM's action on a material's newest version (Story 1.20): the form's `id` and `action` (accept, reprocess, retry or
 * discard) go to the backend's route, then the page is refreshed, so it shows the state the backend answered (and,
 * after a refusal, the state that refused it). A refusal comes back as text, never a code. The proxy (src/proxy.ts)
 * and Next.js refuse a cross-origin post before this runs.
 */
export async function materialAction(_previous: MaterialActionState, form: FormData): Promise<MaterialActionState> {
  const { language } = await currentPreferences();
  const id = form.get('id');
  const action = form.get('action');
  if (typeof id !== 'string' || !ID.test(id) || !isAction(action)) {
    return { error: errorText({ category: 'request', code: 'request.invalid' }, language) };
  }
  // The signed-in layout has already sent a visitor without a session to the sign-in screen.
  const token = await currentSessionToken();
  const result = await actOnMaterial(token ?? '', id, action);
  refresh();
  return { error: result.ok ? null : errorText(result.problem, language) };
}
