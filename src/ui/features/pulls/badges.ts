/** Badges shown next to a "review later" entry. Pure so the rules are visible and testable. */
import type { ReviewLaterEntry } from '../../../shared/api.ts';

export type ReviewLaterBadge = 'changed' | 'closed' | 'error';

/** An entry can be changed, closed and unreachable at the same time; all three are worth showing. */
export function reviewLaterBadges(
  entry: Pick<ReviewLaterEntry, 'changedSinceAdded' | 'closed' | 'error'>,
): ReviewLaterBadge[] {
  const badges: ReviewLaterBadge[] = [];
  if (entry.changedSinceAdded) {
    badges.push('changed');
  }
  if (entry.closed) {
    badges.push('closed');
  }
  if (entry.error !== undefined) {
    badges.push('error');
  }
  return badges;
}

export function reviewLaterBadgeLabel(badge: ReviewLaterBadge): string {
  switch (badge) {
    case 'changed':
      return 'updated since added';
    case 'closed':
      return 'closed';
    case 'error':
      return 'error';
  }
}
