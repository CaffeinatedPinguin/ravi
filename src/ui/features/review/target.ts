/** Keeps the diff target in the URL (`?t=…&w=…`), so a review can be bookmarked, reloaded and shared between tabs. */
import type { DiffTarget } from '../../../shared/api.ts';

export const DEFAULT_TARGET: DiffTarget = { kind: 'uncommitted' };

/**
 * The encoded target stays the stable key of a review (and the export file name), so the worktree
 * is deliberately not part of it: the same comparison can move between linked folders.
 */
export function encodeTarget(target: DiffTarget): string {
  switch (target.kind) {
    case 'branch':
      return `branch:${target.base}`;
    case 'all':
      return `all:${target.base}`;
    case 'range':
      // Three dots mean "from the common ancestor", the same notation git uses.
      return `range:${target.from}${target.mergeBase ? '...' : '..'}${target.to}`;
    default:
      return target.kind;
  }
}

/** `worktree` is the `w` query parameter; an empty value means the connected folder. */
export function decodeTarget(value: string | null, worktree?: string | null): DiffTarget {
  const decoded = decodeKind(value);
  return worktree === undefined || worktree === null || worktree === '' ? decoded : { ...decoded, worktree };
}

function decodeKind(value: string | null): DiffTarget {
  if (value === 'unstaged' || value === 'staged' || value === 'uncommitted') {
    return { kind: value };
  }
  if (value?.startsWith('branch:') && value.length > 'branch:'.length) {
    return { kind: 'branch', base: value.slice('branch:'.length) };
  }
  if (value?.startsWith('all:') && value.length > 'all:'.length) {
    return { kind: 'all', base: value.slice('all:'.length) };
  }
  const range = value?.startsWith('range:') ? /^(.+?)(\.{2,3})(.+)$/.exec(value.slice('range:'.length)) : null;
  if (range?.[1] !== undefined && range[3] !== undefined) {
    return { kind: 'range', from: range[1], to: range[3], mergeBase: range[2] === '...' };
  }
  return DEFAULT_TARGET;
}

/** Screen URL for a target; the worktree travels in `w` so one screen can address every linked folder. */
export function targetPath(repoId: string, target: DiffTarget): string {
  const search = `t=${encodeURIComponent(encodeTarget(target))}`;
  return target.worktree === undefined ? `/repo/${repoId}?${search}` : `/repo/${repoId}?${search}&w=${encodeURIComponent(target.worktree)}`;
}

/** Untracked files only exist in the working tree, so the option is meaningless for other targets. */
export function showsWorkingTree(target: DiffTarget): boolean {
  return target.kind === 'uncommitted' || target.kind === 'unstaged' || target.kind === 'all';
}
