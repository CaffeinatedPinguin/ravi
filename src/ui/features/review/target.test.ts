import { describe, expect, it } from 'vitest';
import type { DiffTarget } from '../../../shared/api.ts';
import { DEFAULT_TARGET, decodeTarget, encodeTarget, showsWorkingTree, targetPath } from './target.ts';

const TARGETS: DiffTarget[] = [
  { kind: 'uncommitted' },
  { kind: 'unstaged' },
  { kind: 'staged' },
  { kind: 'branch', base: 'main' },
  { kind: 'all', base: 'main' },
  { kind: 'range', from: 'main', to: 'HEAD', mergeBase: false },
  { kind: 'range', from: 'HEAD~3', to: 'HEAD', mergeBase: true },
];

const WORKTREE = 'C:/work/ravi-topic';

describe('review target in the URL', () => {
  it('round-trips every kind with and without a worktree', () => {
    for (const target of TARGETS) {
      const encoded = encodeTarget(target);
      expect(decodeTarget(encoded)).toEqual(target);
      // The worktree is not part of the encoded key: it travels as the separate `w` parameter.
      expect(encodeTarget({ ...target, worktree: WORKTREE })).toBe(encoded);
      expect(decodeTarget(encoded, WORKTREE)).toEqual({ ...target, worktree: WORKTREE });
      expect(decodeTarget(encoded, '')).toEqual(target);
    }
  });

  it('falls back to the default target for malformed values', () => {
    expect(decodeTarget(null)).toEqual(DEFAULT_TARGET);
    expect(decodeTarget('')).toEqual(DEFAULT_TARGET);
    expect(decodeTarget('nonsense')).toEqual(DEFAULT_TARGET);
    expect(decodeTarget('branch:')).toEqual(DEFAULT_TARGET);
    expect(decodeTarget('all:')).toEqual(DEFAULT_TARGET);
    expect(decodeTarget('range:only-a-from')).toEqual(DEFAULT_TARGET);
    // The worktree still applies when the target itself is malformed.
    expect(decodeTarget('nonsense', WORKTREE)).toEqual({ ...DEFAULT_TARGET, worktree: WORKTREE });
  });

  it('builds the screen path with the worktree as its own parameter', () => {
    expect(targetPath('abc123', { kind: 'all', base: 'main' })).toBe('/repo/abc123?t=all%3Amain');
    expect(targetPath('abc123', { kind: 'all', base: 'main', worktree: WORKTREE })).toBe(
      `/repo/abc123?t=all%3Amain&w=${encodeURIComponent(WORKTREE)}`,
    );
  });

  it('offers untracked files for every target whose new side is the worktree', () => {
    expect(showsWorkingTree({ kind: 'uncommitted' })).toBe(true);
    expect(showsWorkingTree({ kind: 'unstaged' })).toBe(true);
    expect(showsWorkingTree({ kind: 'all', base: 'main' })).toBe(true);
    expect(showsWorkingTree({ kind: 'staged' })).toBe(false);
    expect(showsWorkingTree({ kind: 'branch', base: 'main' })).toBe(false);
    expect(showsWorkingTree({ kind: 'range', from: 'main', to: 'HEAD', mergeBase: false })).toBe(false);
  });
});
