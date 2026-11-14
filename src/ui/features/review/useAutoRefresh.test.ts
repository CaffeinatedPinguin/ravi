import { describe, expect, it } from 'vitest';
import { formatUpdatedAgo, shouldReloadOnFocus } from './useAutoRefresh.ts';

describe('shouldReloadOnFocus', () => {
  it('keeps the current diff when the repository has not changed', () => {
    expect(shouldReloadOnFocus('sha256:abc', 'sha256:abc')).toBe(false);
  });

  it('reloads when the fingerprint taken at load differs from the current one', () => {
    expect(shouldReloadOnFocus('sha256:abc', 'sha256:def')).toBe(true);
  });
});

describe('formatUpdatedAgo', () => {
  it('moves from "just now" to seconds and then minutes', () => {
    expect(formatUpdatedAgo(10_000, 10_000)).toBe('Updated just now');
    expect(formatUpdatedAgo(10_000, 10_000 - 42_000)).toBe('Updated 42 s ago');
    expect(formatUpdatedAgo(10_000, 10_000 - 180_000)).toBe('Updated 3 min ago');
  });
});
