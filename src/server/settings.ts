import 'server-only';

/**
 * The frontend's settings, read from the environment and checked before anything starts.
 *
 * - `GMSHIELD_MODE=test` (set only by the pipeline): no secret is needed, and the backend is the
 *   stand-in backend at `http://stand-in-backend:8080` unless `GMSHIELD_BACKEND_URL` is set.
 * - No mode: `GMSHIELD_BACKEND_URL` is required.
 *
 * A refusal names settings and never holds a value.
 */
export const MODE = 'GMSHIELD_MODE';
export const TEST_MODE = 'test';
export const BACKEND_URL = 'GMSHIELD_BACKEND_URL';
export const TEST_MODE_BACKEND_URL = 'http://stand-in-backend:8080';

export type Settings = {
  readonly testMode: boolean;
  readonly backendUrl: string;
};

export type RefusalReason = 'mode.unknown' | 'setting.missing' | 'setting.invalid';

export class SettingsRefused extends Error {
  constructor(
    readonly reason: RefusalReason,
    readonly settings: readonly string[],
  ) {
    // Names only: a value never enters the message.
    super(`${reason}: ${settings.join(', ')}`);
    this.name = 'SettingsRefused';
  }
}

type Environment = Readonly<Record<string, string | undefined>>;

function present(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== '';
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.username === '' && url.password === '';
  } catch {
    return false;
  }
}

/** The settings, or a {@link SettingsRefused} that names what is wrong. */
export function checkSettings(environment: Environment): Settings {
  const mode = environment[MODE];
  const testMode = present(mode);
  if (testMode && mode !== TEST_MODE) {
    throw new SettingsRefused('mode.unknown', [MODE]);
  }
  const configured = environment[BACKEND_URL];
  if (!present(configured) && !testMode) {
    throw new SettingsRefused('setting.missing', [BACKEND_URL]);
  }
  const backendUrl = present(configured) ? configured.trim() : TEST_MODE_BACKEND_URL;
  if (!isHttpUrl(backendUrl)) {
    throw new SettingsRefused('setting.invalid', [BACKEND_URL]);
  }
  return { testMode, backendUrl: backendUrl.replace(/\/+$/, '') };
}

/** The settings of this process. The start-up check has already refused a start without them. */
export function currentSettings(): Settings {
  return checkSettings(process.env);
}
