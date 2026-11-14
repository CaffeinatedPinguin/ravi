import { describe, expect, it } from 'vitest';
import { pullRequestChanged } from './status.ts';

const STATUS = { headSha: 'head-2', state: 'open' as const, updatedAt: '2026-11-14T10:00:00.000Z' };

describe('pullRequestChanged', () => {
  it('is false while the forge reports the head the review was opened at', () => {
    expect(pullRequestChanged('head-2', STATUS)).toBe(false);
  });

  it('is true when the head moved', () => {
    expect(pullRequestChanged('head-1', STATUS)).toBe(true);
  });

  it('never raises the banner when the status check failed', () => {
    expect(pullRequestChanged('head-1', undefined)).toBe(false);
    expect(pullRequestChanged('head-1', null)).toBe(false);
  });
});
