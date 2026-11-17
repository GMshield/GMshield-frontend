'use client';

import { MOVING_STATES, type MaterialState } from './uploads/types';
import { useRefreshWhileMoving } from './useRefreshWhileMoving';

/**
 * Keeps a material's page current (Story 1.15): while its state is moving (uploading, waiting, processing) and the tab
 * is visible, the page's server data is fetched again every 5 s, so "aguardando" becomes "processando · 0 de N páginas"
 * without a reload. It renders nothing.
 */
export function MaterialRefresher({ state }: { readonly state: MaterialState }) {
  useRefreshWhileMoving(MOVING_STATES.includes(state));
  return null;
}
