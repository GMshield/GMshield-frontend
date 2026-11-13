import { describe, expect, it } from 'vitest';

import { MINIMUM_BACKEND_CONTRACT_VERSION, compareVersions, meetsMinimum, parseVersion } from '@/server/contract';

describe('contract version', () => {
  it('parses major.minor.patch only', () => {
    expect(parseVersion('1.2.3')).toEqual([1, 2, 3]);
    expect(parseVersion('10.0.0')).toEqual([10, 0, 0]);
    for (const invalid of ['1.2', '1.2.3.4', 'v1.2.3', '01.2.3', '1.2.3-rc.1', ' 1.2.3', '', '1..3', 'a.b.c', '1234567890.0.0']) {
      expect(parseVersion(invalid), invalid).toBeNull();
    }
    expect(parseVersion(1)).toBeNull();
    expect(parseVersion(null)).toBeNull();
  });

  it('compares numerically, not as text', () => {
    expect(compareVersions([1, 10, 0], [1, 9, 0])).toBeGreaterThan(0);
    expect(compareVersions([0, 9, 9], [1, 0, 0])).toBeLessThan(0);
    expect(compareVersions([2, 0, 0], [1, 99, 99])).toBeGreaterThan(0);
    expect(compareVersions([1, 0, 1], [1, 0, 0])).toBeGreaterThan(0);
    expect(compareVersions([1, 0, 0], [1, 0, 0])).toBe(0);
  });

  it('accepts the minimum and newer, refuses older or malformed versions', () => {
    expect(MINIMUM_BACKEND_CONTRACT_VERSION).toBe('1.0.0');
    expect(meetsMinimum('1.0.0')).toBe(true);
    expect(meetsMinimum('1.0.1')).toBe(true);
    expect(meetsMinimum('2.0.0')).toBe(true);
    expect(meetsMinimum('0.9.0')).toBe(false);
    expect(meetsMinimum('0.99.99')).toBe(false);
    expect(meetsMinimum('1.0')).toBe(false);
    expect(meetsMinimum(undefined)).toBe(false);
    expect(meetsMinimum('1.2.0', '1.10.0')).toBe(false);
  });

  it('refuses a malformed minimum', () => {
    expect(() => meetsMinimum('1.0.0', 'one')).toThrow();
  });
});
