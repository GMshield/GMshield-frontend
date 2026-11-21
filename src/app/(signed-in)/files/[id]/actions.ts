'use server';

import { refresh } from 'next/cache';

import type { MaterialActionState } from '@/components/MaterialActions';
import type { PlaceFormState } from '@/components/MaterialPlace';
import { placeOfBelonging } from '@/components/uploads/types';
import { errorText, problemFields, translator } from '@/messages';
import { currentPreferences } from '@/preferences';
import { flash } from '@/server/flash';
import { actOnMaterial, changeMaterial, getMaterial, MATERIAL_ACTIONS, type MaterialAction, type MaterialChange } from '@/server/materials';
import { currentSessionToken } from '@/server/session-cookies';

/** A material's id as the backend mints it; anything else is a material nowhere. */
const ID = /^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$/;
/** At most 15 digits: always a safe integer. */
const VERSION = /^(?:0|[1-9]\d{0,14})$/;
/** The most systems a material may belong to (the backend checks it again). */
const MAX_SYSTEMS = 100;

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
  if (result.ok) {
    await flash('success', translator(language)(`feedback.material.${action}`, { name: result.data.name }));
  }
  refresh();
  return { error: result.ok ? null : errorText(result.problem, language) };
}

/** Where the form says the material goes, as the backend takes it; null for anything the form cannot post. */
function belongingOf(form: FormData): MaterialChange['belonging'] | null {
  const ids = (name: string) => form.getAll(name).filter((value): value is string => typeof value === 'string');
  switch (form.get('belonging')) {
    case 'campaign': {
      const campaign = form.get('campaign');
      return typeof campaign === 'string' && ID.test(campaign) ? { campaign } : null;
    }
    case 'system': {
      const system = form.get('system');
      return typeof system === 'string' && ID.test(system) ? { systems: [system] } : null;
    }
    case 'systems': {
      const systems = ids('systems');
      return systems.length > 0 && systems.length <= MAX_SYSTEMS && systems.every((id) => ID.test(id)) ? { systems } : null;
    }
    default:
      return null;
  }
}

/**
 * "Salvar" in a material's "Onde pertence" (Story 3.3): the form's place (`belonging`: campaign, system or systems, with
 * `campaign`, `system` or each `systems`) goes to the backend on the form's `version`, then the page is refreshed, so it
 * shows the new place; the answer says it was saved. A stale version brings the material's current place and version,
 * and says so (the page is refreshed too); any other refusal comes back as text, never a code. Nothing goes back to no
 * place: a form without a place never reaches the backend. The proxy (src/proxy.ts) and Next.js refuse a cross-origin
 * post before this runs.
 */
export async function changePlaceAction(previous: PlaceFormState, form: FormData): Promise<PlaceFormState> {
  const { language } = await currentPreferences();
  const serial = previous.serial + 1;
  const id = form.get('id');
  const version = form.get('version');
  const belonging = belongingOf(form);
  if (typeof id !== 'string' || !ID.test(id) || typeof version !== 'string' || !VERSION.test(version) || belonging === null) {
    return { ...previous, error: errorText({ category: 'request', code: 'request.invalid' }, language), stale: false, saved: false, serial };
  }
  // The signed-in layout has already sent a visitor without a session to the sign-in screen.
  const token = (await currentSessionToken()) ?? '';
  const result = await changeMaterial(token, id, { version: Number(version), belonging });
  if (result.ok) {
    refresh();
    return {
      version: result.data.version,
      place: placeOfBelonging(result.data.belonging),
      error: null,
      stale: false,
      saved: true,
      serial,
      reset: previous.reset + 1,
    };
  }
  if (problemFields(result.problem).code === 'request.stale_version') {
    const current = await getMaterial(token, id);
    if (current.ok) {
      refresh();
      return {
        version: current.data.version,
        place: placeOfBelonging(current.data.belonging),
        error: translator(language)('material.belonging.stale'),
        stale: true,
        saved: false,
        serial,
        reset: previous.reset + 1,
      };
    }
    return { ...previous, error: errorText(current.problem, language), stale: false, saved: false, serial };
  }
  return { ...previous, error: errorText(result.problem, language), stale: false, saved: false, serial };
}
