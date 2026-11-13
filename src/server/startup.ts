import 'server-only';

import { NO_TRACE, logEvent } from './log';
import { SettingsRefused, checkSettings } from './settings';

/** Exit status of a refused start (EX_CONFIG), the same as the backend's. */
export const REFUSED_EXIT_STATUS = 78;

/** Stops the process before it serves anything when the settings do not allow a start. */
export function checkStartup(environment: Readonly<Record<string, string | undefined>> = process.env): void {
  try {
    const settings = checkSettings(environment);
    logEvent('INFO', 'server.startup', 'startup.checked', NO_TRACE, { testMode: settings.testMode });
  } catch (error) {
    if (!(error instanceof SettingsRefused)) {
      throw error;
    }
    logEvent('ERROR', 'server.startup', 'startup.refused', NO_TRACE, { reason: error.reason, settings: error.settings });
    process.exit(REFUSED_EXIT_STATUS);
  }
}
