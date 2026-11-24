'use server';

import { refresh, revalidatePath } from 'next/cache';

import type { ProposalDecisionState } from '@/components/ProposalList';
import { errorText, problemFields, translator } from '@/messages';
import { currentPreferences } from '@/preferences';
import { flash } from '@/server/flash';
import { decideProposal, type ProposalChoice } from '@/server/library';
import { currentSessionToken } from '@/server/session-cookies';

/** An id as the backend mints it; anything else is an item nowhere. */
const ID = /^[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$/;
/** At most 15 digits: always a safe integer. */
const VERSION = /^(?:0|[1-9]\d{0,14})$/;
/** Far past the name's limit, so the backend still sees a name too long and names it; only a runaway post is cut. */
const MOST = 10_000;

/** The decision the form posts, as the backend takes it; null for anything the form cannot post. */
function choiceOf(form: FormData, version: number): ProposalChoice | null {
  switch (form.get('decision')) {
    case 'approve':
      return { decision: 'approve', version };
    case 'rename': {
      const name = form.get('name');
      return typeof name === 'string' ? { decision: 'approve', version, name: name.slice(0, MOST) } : null;
    }
    case 'merge': {
      const target = form.get('target');
      return typeof target === 'string' && ID.test(target) ? { decision: 'merge', version, targetId: target } : null;
    }
    case 'reject':
      return { decision: 'reject', version };
    default:
      return null;
  }
}

/**
 * A decision on a pending ontology proposal (Story 4.4), from a row of {@link ProposalList} on a system's "Ontologia"
 * tab or a material's page: approve it (as proposed, or under the typed name), merge it into a record type or term of
 * its system, or reject it, on the version the page read. Once the backend has taken it, a toast says what was done,
 * the system's and the material's pages are revalidated and the page is read again, so the proposal leaves the list
 * (and an approved type or term shows on the system). A stale version says so (another tab decided first); any other
 * refusal comes back as its text, never a code. A malformed form never reaches the backend. The proxy (src/proxy.ts)
 * and Next.js refuse a cross-origin post before this runs.
 */
export async function decideProposalAction(previous: ProposalDecisionState, form: FormData): Promise<ProposalDecisionState> {
  const { language } = await currentPreferences();
  const t = translator(language);
  const serial = previous.serial + 1;
  const id = form.get('id');
  const version = form.get('version');
  const choice = typeof version === 'string' && VERSION.test(version) ? choiceOf(form, Number(version)) : null;
  if (typeof id !== 'string' || !ID.test(id) || choice === null) {
    return { error: errorText({ category: 'request', code: 'request.invalid' }, language), stale: false, serial };
  }
  // The signed-in layout has already sent a visitor without a session to the sign-in screen.
  const token = (await currentSessionToken()) ?? '';
  const result = await decideProposal(token, id, choice);
  if (result.ok) {
    const { name, kind, state } = result.data.proposal;
    const approvedName = choice.decision === 'approve' && choice.name !== undefined ? choice.name.trim() : name;
    const text =
      state === 'approved'
        ? t(kind === 'term' ? 'feedback.proposal.termApproved' : 'feedback.proposal.typeApproved', { name: approvedName })
        : t(state === 'merged' ? 'feedback.proposal.merged' : 'feedback.proposal.rejected', { name });
    await flash('success', text);
    revalidatePath('/systems/[id]', 'page');
    revalidatePath('/files/[id]', 'page');
    refresh();
    return { error: null, stale: false, serial };
  }
  if (problemFields(result.problem).code === 'request.stale_version') {
    return { error: null, stale: true, serial };
  }
  return { error: errorText(result.problem, language), stale: false, serial };
}
