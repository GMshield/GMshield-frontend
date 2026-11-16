import 'server-only';

/**
 * The frontend's settings, read from the environment and checked before anything starts.
 *
 * - `GMSHIELD_MODE=test` (set only by the pipeline): no secret is needed, the backend is the
 *   stand-in backend at `http://stand-in-backend:8080` unless `GMSHIELD_BACKEND_URL` is set, and the
 *   service credential is the fixed, public {@link TEST_MODE_FRONTEND_CREDENTIAL} that the backend's
 *   test mode also uses. A `GMSHIELD_FRONTEND_CREDENTIAL` beside test mode is refused.
 * - No mode: `GMSHIELD_BACKEND_URL` and `GMSHIELD_FRONTEND_CREDENTIAL` are required.
 *
 * A refusal names settings and never holds a value.
 */
export const MODE = 'GMSHIELD_MODE';
export const TEST_MODE = 'test';
export const BACKEND_URL = 'GMSHIELD_BACKEND_URL';
/** The service credential the backend requires on every `/api/v1` call (Story 1.10): a secret. */
export const FRONTEND_CREDENTIAL = 'GMSHIELD_FRONTEND_CREDENTIAL';
// Test mode only: the stand-in backend on the pipeline's isolated run network, which has no TLS.
export const TEST_MODE_BACKEND_URL = 'http://stand-in-backend:8080'; // NOSONAR: test-mode address
/** Test mode only: the backend's fixed test-mode credential (application-test-mode.yaml). Public, never a secret. */
export const TEST_MODE_FRONTEND_CREDENTIAL = 'gmshield-test-mode-frontend-credential-not-a-secret'; // NOSONAR: public test value

/** 32 to 512 characters a header can carry; the pipeline writes 64 hex characters. */
const CREDENTIAL = /^[A-Za-z0-9._~+/=-]{32,512}$/;

export type Settings = {
  readonly testMode: boolean;
  readonly backendUrl: string;
  readonly frontendCredential: string;
};

export type RefusalReason = 'mode.unknown' | 'setting.missing' | 'setting.invalid' | 'mode.test_with_production_secret';

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

function withoutTrailingSlashes(url: string): string {
  let end = url.length;
  while (end > 0 && url[end - 1] === '/') {
    end -= 1;
  }
  return url.slice(0, end);
}

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
  const credential = environment[FRONTEND_CREDENTIAL];
  if (testMode && present(credential)) {
    throw new SettingsRefused('mode.test_with_production_secret', [MODE, FRONTEND_CREDENTIAL]);
  }
  if (!testMode) {
    const missing = [BACKEND_URL, FRONTEND_CREDENTIAL].filter((name) => !present(environment[name]));
    if (missing.length > 0) {
      throw new SettingsRefused('setting.missing', missing);
    }
  }
  const backendUrl = present(configured) ? configured.trim() : TEST_MODE_BACKEND_URL;
  if (!isHttpUrl(backendUrl)) {
    throw new SettingsRefused('setting.invalid', [BACKEND_URL]);
  }
  const frontendCredential = testMode ? TEST_MODE_FRONTEND_CREDENTIAL : (credential ?? '').trim();
  if (!CREDENTIAL.test(frontendCredential)) {
    throw new SettingsRefused('setting.invalid', [FRONTEND_CREDENTIAL]);
  }
  return { testMode, backendUrl: withoutTrailingSlashes(backendUrl), frontendCredential };
}

/** The settings of this process. The start-up check has already refused a start without them. */
export function currentSettings(): Settings {
  return checkSettings(process.env);
}
