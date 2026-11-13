import 'server-only';

/**
 * The oldest backend public contract (`info.version` of `contracts/public.json`) this frontend
 * works with. `GET /api/health` reports unhealthy against an older backend.
 */
export const MINIMUM_BACKEND_CONTRACT_VERSION = '1.0.0';

const VERSION = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/;

export type Version = readonly [major: number, minor: number, patch: number];

/** `major.minor.patch`, or `null` for anything else (pre-releases included). */
export function parseVersion(value: unknown): Version | null {
  if (typeof value !== 'string') {
    return null;
  }
  const match = VERSION.exec(value);
  return match === null ? null : [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Negative when `a` is older than `b`, zero when equal, positive when newer. */
export function compareVersions(a: Version, b: Version): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) {
      return a[i]! - b[i]!;
    }
  }
  return 0;
}

/** Whether a reported version is valid and at least the minimum. */
export function meetsMinimum(reported: unknown, minimum: string = MINIMUM_BACKEND_CONTRACT_VERSION): boolean {
  const version = parseVersion(reported);
  const floor = parseVersion(minimum);
  if (floor === null) {
    throw new Error('The minimum contract version is not major.minor.patch');
  }
  return version !== null && compareVersions(version, floor) >= 0;
}
