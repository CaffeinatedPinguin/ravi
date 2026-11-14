import { describe, expect, it } from 'vitest';
import type { ReviewComment } from '../../../shared/review.ts';
import {
  groupThreads,
  outsideThreadKey,
  partitionThreads,
  pathFromOutsideThreadKey,
  threadKey,
} from './threads.ts';

function comment(overrides: Partial<ReviewComment> & Pick<ReviewComment, 'id'>): ReviewComment {
  return {
    parentId: null,
    path: 'src/a.ts',
    side: 'new',
    line: 2,
    startLine: null,
    body: 'body',
    author: null,
    state: 'draft',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    codeContext: null,
    outdated: false,
    ...overrides,
  };
}

describe('groupThreads', () => {
  it('groups by path, side and line and keeps replies in document order', () => {
    const threads = groupThreads([
      comment({ id: 'root-1' }),
      comment({ id: 'reply-1', parentId: 'root-1' }),
      comment({ id: 'root-2', line: 8 }),
      comment({ id: 'reply-2', parentId: 'root-1' }),
      comment({ id: 'root-old', side: 'old' }),
      comment({ id: 'other-path', path: 'src/b.ts' }),
    ]);

    expect(threads.map((thread) => thread.key)).toEqual([
      threadKey('src/a.ts', 'new', 2),
      threadKey('src/a.ts', 'new', 8),
      threadKey('src/a.ts', 'old', 2),
      threadKey('src/b.ts', 'new', 2),
    ]);
    expect(threads[0]?.comments.map((entry) => entry.id)).toEqual(['root-1', 'reply-1', 'reply-2']);
    expect(threads[1]?.comments.map((entry) => entry.id)).toEqual(['root-2']);
  });

  it('attaches a reply that appears before its root', () => {
    const threads = groupThreads([
      comment({ id: 'reply', parentId: 'root' }),
      comment({ id: 'root' }),
      comment({ id: 'after', parentId: 'root' }),
    ]);

    expect(threads).toHaveLength(1);
    expect(threads[0]?.comments.map((entry) => entry.id)).toEqual(['root', 'reply', 'after']);
  });

  it('ignores review-level comments', () => {
    const threads = groupThreads([comment({ id: 'review', path: null, line: null })]);
    expect(threads).toEqual([]);
  });
});

describe('partitionThreads', () => {
  it('puts threads on lines missing from the visible hunks into the outside group', () => {
    const threads = groupThreads([
      comment({ id: 'visible', line: 2 }),
      comment({ id: 'hidden', line: 99 }),
    ]);

    const { inline, outside } = partitionThreads(threads, new Set([threadKey('src/a.ts', 'new', 2)]));
    expect(inline.map((thread) => thread.comments[0]?.id)).toEqual(['visible']);
    expect(outside.map((thread) => thread.comments[0]?.id)).toEqual(['hidden']);
  });
});

describe('outside thread keys', () => {
  it('round-trips the file path, including NUL-free arbitrary characters', () => {
    const key = outsideThreadKey('src/with space/[brackets].ts');
    expect(pathFromOutsideThreadKey(key)).toBe('src/with space/[brackets].ts');
  });
});
