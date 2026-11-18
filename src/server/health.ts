import 'server-only';

import { createBackendClient } from './backend/client';
import { MINIMUM_BACKEND_CONTRACT_VERSION, meetsMinimum, parseVersion } from './contract';
import { logEvent } from './log';
import { currentSettings } from './settings';
import { outgoingTraceparent, traceFrom } from './trace';

const UNIT = 'server.health';

export type HealthOptions = {
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
};

/** The kind of a failed call, never its message: a message may quote what the other side sent. */
export function errorType(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      return 'timeout';
    }
    const cause = (error as { cause?: unknown }).cause;
    const code = typeof cause === 'object' && cause !== null ? (cause as { code?: unknown }).code : undefined;
    if (typeof code === 'string' && /^[A-Z_]{1,40}$/.test(code)) {
      return code;
    }
    if (/^[A-Za-z]{1,40}$/.test(error.name)) {
      return error.name;
    }
  }
  return 'unknown';
}

/**
 * Whether the backend answers and its public contract is at least
 * {@link MINIMUM_BACKEND_CONTRACT_VERSION}. Every failure is one log line; nothing the backend sent
 * is logged except a well-formed version.
 */
export async function backendIsHealthy(incomingTraceparent: string | null, options: HealthOptions = {}): Promise<boolean> {
  const trace = traceFrom(incomingTraceparent);
  const client = createBackendClient({
    baseUrl: options.baseUrl ?? currentSettings().backendUrl,
    traceparent: outgoingTraceparent(trace),
    timeoutMs: options.timeoutMs,
  });
  try {
    const { data, response } = await client.GET('/api/v1/version');
    if (!response.ok || data === undefined) {
      logEvent('WARN', UNIT, 'health.backend_failed', trace.traceId, { backendStatus: response.status });
      return false;
    }
    if (parseVersion(data.version) === null) {
      logEvent('WARN', UNIT, 'health.backend_version_invalid', trace.traceId);
      return false;
    }
    if (!meetsMinimum(data.version)) {
      logEvent('WARN', UNIT, 'health.backend_outdated', trace.traceId, {
        backendVersion: data.version,
        minimumVersion: MINIMUM_BACKEND_CONTRACT_VERSION,
      });
      return false;
    }
    return true;
  } catch (error) {
    logEvent('WARN', UNIT, 'health.backend_unreachable', trace.traceId, { errorType: errorType(error) });
    return false;
  }
}
