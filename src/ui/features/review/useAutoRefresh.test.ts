import { describe, expect, it } from 'vitest';
import { formatRefreshedAgo, shouldReloadOnFocus } from './useAutoRefresh.ts';

describe('shouldReloadOnFocus', () => {
  it('keeps the current diff when the repository has not changed', () => {
    expect(shouldReloadOnFocus('sha256:abc', 'sha256:abc')).toBe(false);
  });

  it('reloads when the fingerprint taken at load differs from the current one', () => {
    expect(shouldReloadOnFocus('sha256:abc', 'sha256:def')).toBe(true);
  });
});

describe('formatRefreshedAgo', () => {
  it('moves from "just now" to seconds and then minutes', () => {
    expect(formatRefreshedAgo(10_000, 10_000)).toBe('just now');
    expect(formatRefreshedAgo(10_000, 10_000 - 42_000)).toBe('42 s ago');
    expect(formatRefreshedAgo(10_000, 10_000 - 180_000)).toBe('3 min ago');
  });

  it('uses the documented boundaries and never reports a negative age', () => {
    expect(formatRefreshedAgo(10_000, 10_000 - 4_000)).toBe('just now');
    expect(formatRefreshedAgo(10_000, 10_000 - 5_000)).toBe('5 s ago');
    expect(formatRefreshedAgo(10_000, 10_000 - 60_000)).toBe('1 min ago');
    // A clock that jumps backwards must not render "-2 s ago" in the tooltip.
    expect(formatRefreshedAgo(10_000, 20_000)).toBe('just now');
  });
});
