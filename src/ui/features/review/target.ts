/** Keeps the diff target in the URL (`?t=…`), so a review can be bookmarked, reloaded and shared between tabs. */
import type { DiffTarget } from '../../../shared/api.ts';

export const DEFAULT_TARGET: DiffTarget = { kind: 'uncommitted' };

export function encodeTarget(target: DiffTarget): string {
  switch (target.kind) {
    case 'branch':
      return `branch:${target.base}`;
    case 'range':
      // Three dots mean "from the common ancestor", the same notation git uses.
      return `range:${target.from}${target.mergeBase ? '...' : '..'}${target.to}`;
    default:
      return target.kind;
  }
}

export function decodeTarget(value: string | null): DiffTarget {
  if (value === 'unstaged' || value === 'staged' || value === 'uncommitted') {
    return { kind: value };
  }
  if (value?.startsWith('branch:') && value.length > 'branch:'.length) {
    return { kind: 'branch', base: value.slice('branch:'.length) };
  }
  const range = value?.startsWith('range:') ? /^(.+?)(\.{2,3})(.+)$/.exec(value.slice('range:'.length)) : null;
  if (range?.[1] !== undefined && range[3] !== undefined) {
    return { kind: 'range', from: range[1], to: range[3], mergeBase: range[2] === '...' };
  }
  return DEFAULT_TARGET;
}

/** Untracked files only exist in the working tree, so the option is meaningless for other targets. */
export function showsWorkingTree(target: DiffTarget): boolean {
  return target.kind === 'uncommitted' || target.kind === 'unstaged';
}
