import { vi } from 'vitest';

/** Collects what the code under test writes to stdout and stderr; `vi.restoreAllMocks()` ends it. */
export function captureOutput(): { lines: () => Record<string, unknown>[]; raw: () => string } {
  let written = '';
  const keep = ((chunk: unknown) => {
    written += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  vi.spyOn(process.stdout, 'write').mockImplementation(keep);
  vi.spyOn(process.stderr, 'write').mockImplementation(keep);
  return {
    raw: () => written,
    lines: () =>
      written
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}
