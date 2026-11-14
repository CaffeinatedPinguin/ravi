import { describe, expect, it } from 'vitest';
import type { DiffFile } from '../../../shared/api.ts';
import type { Thread } from '../../../shared/forge.ts';
import { outsideThreadKey, threadKey } from '../comments/threads.ts';
import { parsePatch } from '../diff/patch.ts';
import { buildFileRows } from '../diff/rows.ts';
import type { FileView } from '../diff/rows.ts';
import { conversationThreads, remoteThreadsForPath } from './remoteThreads.ts';

const PATH = 'src/a.ts';
const PATCH = '@@ -1,2 +1,3 @@\n one\n+two\n three\n';

function view(): FileView {
  const file: DiffFile = {
    path: PATH,
    oldPath: null,
    status: 'modified',
    additions: 1,
    deletions: 0,
    binary: false,
  };
  return {
    file,
    collapsed: false,
    load: { status: 'loaded', patch: parsePatch(PATCH) },
    forceLarge: false,
    expansions: new Map(),
    blob: null,
  };
}

function remote(overrides: Partial<Thread> = {}): Thread {
  return {
    id: 'thread-1',
    path: PATH,
    side: 'new',
    line: 2,
    startLine: null,
    outdated: false,
    resolved: false,
    comments: [
      {
        id: 'c-1',
        author: 'octocat',
        body: 'Please change this',
        createdAt: '2026-11-14T10:00:00.000Z',
        updatedAt: '2026-11-14T10:00:00.000Z',
        canEdit: false,
      },
    ],
    ...overrides,
  };
}

describe('remoteThreadsForPath', () => {
  it('anchors a new-side thread after the same line the row builder uses', () => {
    const threads = remoteThreadsForPath([remote()], PATH);
    const rows = buildFileRows(view(), 'unified', threads);

    expect(threads[0]?.key).toBe(threadKey(PATH, 'new', 2));
    expect(rows[2]).toMatchObject({ kind: 'line', line: { newNo: 2 } });
    expect(rows[3]).toEqual({ kind: 'thread', threadKey: threadKey(PATH, 'new', 2) });
  });

  it('places an old-side thread on the old line number', () => {
    const threads = remoteThreadsForPath([remote({ side: 'old', line: 1 })], PATH);
    const rows = buildFileRows(view(), 'unified', threads);

    expect(threads[0]?.key).toBe(threadKey(PATH, 'old', 1));
    expect(rows[2]).toEqual({ kind: 'thread', threadKey: threadKey(PATH, 'old', 1) });
  });

  it('sends an outdated thread to the outside group instead of a stale line', () => {
    const threads = remoteThreadsForPath([remote({ outdated: true })], PATH);
    const rows = buildFileRows(view(), 'unified', threads);

    expect(threads[0]?.key).toBe(outsideThreadKey(PATH));
    expect(rows[1]).toEqual({ kind: 'thread', threadKey: outsideThreadKey(PATH) });
    expect(rows.slice(2).some((row) => row.kind === 'thread')).toBe(false);
  });

  it('keeps a path-less thread out of Files changed and in Conversation only', () => {
    const prLevel = remote({ path: null, line: null });
    const rows = buildFileRows(view(), 'unified', remoteThreadsForPath([prLevel], PATH));

    expect(rows.some((row) => row.kind === 'thread')).toBe(false);
    expect(conversationThreads([prLevel, remote()])).toEqual([prLevel]);
  });
});
