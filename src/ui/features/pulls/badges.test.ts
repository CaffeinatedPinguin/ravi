import { describe, expect, it } from 'vitest';
import { reviewLaterBadges } from './badges.ts';

describe('reviewLaterBadges', () => {
  it('shows nothing when the entry still matches what was added', () => {
    expect(reviewLaterBadges({ changedSinceAdded: false, closed: false })).toEqual([]);
  });

  it('marks a moved head as updated since added', () => {
    expect(reviewLaterBadges({ changedSinceAdded: true, closed: false })).toEqual(['changed']);
  });

  it('marks a closed or merged entry', () => {
    expect(reviewLaterBadges({ changedSinceAdded: false, closed: true })).toEqual(['closed']);
  });

  it('reports an unreachable forge without hiding the other badges', () => {
    expect(reviewLaterBadges({ changedSinceAdded: true, closed: true, error: 'forge is down' })).toEqual([
      'changed',
      'closed',
      'error',
    ]);
  });
});
