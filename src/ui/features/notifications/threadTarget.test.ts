import { describe, expect, it } from 'vitest';
import type { Thread } from '../../../shared/forge.ts';
import type { CommentThread } from '../comments/threads.ts';
import { outsideThreadKey, threadKey } from '../comments/threads.ts';
import type { Row } from '../diff/rows.ts';
import { locateThread } from './threadTarget.ts';

function thread(change: Partial<Thread> & Pick<Thread, 'id'>): Thread {
  return {
    path: 'src/a.ts',
    side: 'new',
    line: 3,
    startLine: null,
    outdated: false,
    resolved: false,
    comments: [],
    ...change,
  };
}

function remoteCommentThread(key: string, remote: Thread): CommentThread {
  return {
    key,
    path: remote.path ?? '',
    side: remote.side,
    line: remote.line ?? 1,
    startLine: remote.startLine,
    comments: [],
    remote,
  };
}

type RowEntry = { fileIndex: number; row: Row };

const fileRow: Row = { kind: 'file' };
const loadingRow: Row = { kind: 'notice', notice: 'loading', height: 56 };

function source(entries: RowEntry[], threads: CommentThread[]) {
  return {
    rowCount: entries.length,
    rowAt: (index: number) => entries[index] ?? null,
    threadsOf: (key: string) => threads.filter((candidate) => candidate.key === key),
  };
}

describe('locateThread', () => {
  it('finds the thread row across files, not just the file it belongs to', () => {
    const remote = thread({ id: 't-inline', path: 'src/b.ts', line: 12 });
    const inline = remoteCommentThread(threadKey('src/b.ts', 'new', 12), remote);
    const entries: RowEntry[] = [
      { fileIndex: 0, row: fileRow },
      { fileIndex: 0, row: loadingRow },
      { fileIndex: 1, row: fileRow },
      { fileIndex: 1, row: { kind: 'thread', threadKey: inline.key } },
    ];

    expect(locateThread(remote, source(entries, [inline]))).toEqual({
      kind: 'row',
      rowIndex: 3,
      fileIndex: 1,
    });
  });

  it('finds a thread collected in the outside the shown lines group', () => {
    const remote = thread({ id: 't-outside', outdated: true });
    const outside = remoteCommentThread(outsideThreadKey('src/a.ts'), remote);
    const entries: RowEntry[] = [
      { fileIndex: 0, row: fileRow },
      { fileIndex: 0, row: { kind: 'thread', threadKey: outside.key } },
    ];

    expect(locateThread(remote, source(entries, [outside]))).toEqual({
      kind: 'row',
      rowIndex: 1,
      fileIndex: 0,
    });
  });

  it('sends a pull request level thread to the Conversation tab', () => {
    const conversation = thread({ id: 't-pr', path: null, line: null });

    expect(locateThread(conversation, null)).toEqual({ kind: 'conversation' });
  });

  it('returns null while the session is missing or when the thread has no row yet', () => {
    const inline = thread({ id: 't-inline' });
    const outside = remoteCommentThread(outsideThreadKey('src/a.ts'), thread({ id: 't-other' }));
    const entries: RowEntry[] = [
      { fileIndex: 0, row: fileRow },
      { fileIndex: 0, row: { kind: 'thread', threadKey: outside.key } },
    ];

    expect(locateThread(inline, null)).toBeNull();
    expect(locateThread(inline, source(entries, [outside]))).toBeNull();
  });
});
