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
    // Story 4.2: it reads a report's records by type and the warning report.records_unread, added in 1.34.0.
    // Story 4.1: it lists a system's record types, added in 1.33.0.
    // Story 3.12: it bookmarks answers, reads `bookmarked` on turns and lists the saved answers, added in 1.32.0.
    // Story 3.11: it dismisses an answer and undoes the dismissal, added in 1.31.0.
    // Story 3.10 part B: it previews and deletes a conversation, added in 1.30.0.
    // Story 3.10: it lists, reads and renames conversations by area and continues one, added in 1.29.0.
    // Story 3.9: it creates and reads searches of the library, added in 1.28.0. Story 3.8: it reads done's modelKnowledge and the model tier event, added in 1.27.0. Story 3.7: the frontend shows
    // each reference's tier and the answer's tier events, added in 1.26.0. Story 3.6: it
    // reads and changes a campaign's scope settings, added in 1.25.0 (with the current-scope page, Story 3.5); 1.24.0
    // added a material's deletion, a superseded version's removal and `superseded` (Story 3.4 part B).
    expect(MINIMUM_BACKEND_CONTRACT_VERSION).toBe('1.34.0');
    expect(meetsMinimum('1.34.0')).toBe(true);
    expect(meetsMinimum('1.34.1')).toBe(true);
    expect(meetsMinimum('1.35.0')).toBe(true);
    expect(meetsMinimum('1.33.0')).toBe(false);
    expect(meetsMinimum('1.32.0')).toBe(false);
    expect(meetsMinimum('1.31.0')).toBe(false);
    expect(meetsMinimum('1.30.0')).toBe(false);
    expect(meetsMinimum('1.29.0')).toBe(false);
    expect(meetsMinimum('1.28.0')).toBe(false);
    expect(meetsMinimum('1.27.0')).toBe(false);
    expect(meetsMinimum('1.26.0')).toBe(false);
    expect(meetsMinimum('1.25.0')).toBe(false);
    expect(meetsMinimum('1.24.0')).toBe(false);
    expect(meetsMinimum('1.24.1')).toBe(false);
    expect(meetsMinimum('1.23.0')).toBe(false);
    expect(meetsMinimum('1.22.0')).toBe(false);
    expect(meetsMinimum('1.21.0')).toBe(false);
    expect(meetsMinimum('1.20.0')).toBe(false);
    expect(meetsMinimum('1.19.0')).toBe(false);
    expect(meetsMinimum('1.18.0')).toBe(false);
    expect(meetsMinimum('1.17.0')).toBe(false);
    expect(meetsMinimum('1.16.0')).toBe(false);
    expect(meetsMinimum('1.15.0')).toBe(false);
    expect(meetsMinimum('1.14.0')).toBe(false);
    expect(meetsMinimum('1.13.0')).toBe(false);
    expect(meetsMinimum('1.12.0')).toBe(false);
    expect(meetsMinimum('1.11.0')).toBe(false);
    expect(meetsMinimum('1.10.0')).toBe(false);
    expect(meetsMinimum('1.9.0')).toBe(false);
    expect(meetsMinimum('1.8.0')).toBe(false);
    expect(meetsMinimum('1.6.0')).toBe(false);
    expect(meetsMinimum('1.5.0')).toBe(false);
    expect(meetsMinimum('1.4.0')).toBe(false);
    expect(meetsMinimum('1.3.0')).toBe(false);
    expect(meetsMinimum('1.2.0')).toBe(false);
    expect(meetsMinimum('1.1.0')).toBe(false);
    expect(meetsMinimum('1.0.0')).toBe(false);
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
