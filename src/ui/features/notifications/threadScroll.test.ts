import { describe, expect, it, vi } from 'vitest';
import type { Thread } from '../../../shared/forge.ts';
import type { CommentThread } from '../comments/threads.ts';
import { outsideThreadKey, threadKey } from '../comments/threads.ts';
import type { Row } from '../diff/rows.ts';
import { scrollToThread } from './threadScroll.ts';

function thread(change: Partial<Thread> & Pick<Thread, 'id'>): Thread {
  return {
    path: 'src/b.ts',
    side: 'new',
    line: 12,
    startLine: null,
    outdated: false,
    resolved: false,
    comments: [],
    ...change,
  };
}

function remoteThread(key: string, remote: Thread): CommentThread {
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

function session(entries: RowEntry[], threads: CommentThread[], files: string[]) {
  return {
    rowCount: entries.length,
    rowAt: (index: number) => entries[index] ?? null,
    threadsOf: (key: string) => threads.filter((candidate) => candidate.key === key),
    files: files.map((path) => ({ path })),
  };
}

function handle() {
  return { scrollToFile: vi.fn(), scrollToRow: vi.fn() };
}

describe('scrollToThread', () => {
  it('gives the handle the row index of the linked thread', () => {
    const remote = thread({ id: 't-inline', path: 'src/b.ts' });
    const inline = remoteThread(threadKey('src/b.ts', 'new', 12), remote);
    const rows: RowEntry[] = [
      { fileIndex: 0, row: fileRow },
      { fileIndex: 1, row: fileRow },
      { fileIndex: 1, row: loadingRow },
      { fileIndex: 1, row: { kind: 'thread', threadKey: inline.key } },
    ];
    const diff = handle();

    expect(scrollToThread('t-inline', [remote], session(rows, [inline], ['src/a.ts', 'src/b.ts']), diff)).toBe('scrolled');
    expect(diff.scrollToRow).toHaveBeenCalledWith(3);
    expect(diff.scrollToFile).not.toHaveBeenCalled();
  });

  it('falls back to opening the file when the row for the thread id is unknown', () => {
    const remote = thread({ id: 't-missing', path: 'src/b.ts' });
    const rows: RowEntry[] = [{ fileIndex: 0, row: fileRow }];
    const diff = handle();

    expect(scrollToThread('t-missing', [remote], session(rows, [], ['src/a.ts', 'src/b.ts']), diff)).toBe('opened');
    expect(diff.scrollToFile).toHaveBeenCalledWith(1);
    expect(diff.scrollToRow).not.toHaveBeenCalled();
  });

  it('opens the thread file for a view without row scrolling', () => {
    const remote = thread({ id: 't-inline', path: 'src/b.ts' });
    const inline = remoteThread(threadKey('src/b.ts', 'new', 12), remote);
    const rows: RowEntry[] = [
      { fileIndex: 1, row: fileRow },
      { fileIndex: 1, row: { kind: 'thread', threadKey: inline.key } },
    ];
    const diff = { scrollToFile: vi.fn() };

    expect(scrollToThread('t-inline', [remote], session(rows, [inline], ['src/a.ts', 'src/b.ts']), diff)).toBe('opened');
    expect(diff.scrollToFile).toHaveBeenCalledWith(1);
  });

  it('leaves a pull request level thread to the Conversation tab', () => {
    const remote = thread({ id: 't-pr', path: null, line: null });
    const outside = remoteThread(outsideThreadKey('src/b.ts'), remote);

    expect(scrollToThread('t-pr', [remote], session([], [outside], []), handle())).toBe('conversation');
  });
});
