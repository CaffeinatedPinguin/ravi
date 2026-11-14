import { describe, expect, it } from 'vitest';
import type { DiffFile } from '../../../shared/api.ts';
import type { CommentSide } from '../../../shared/review.ts';
import type { CommentThread } from '../comments/threads.ts';
import { outsideThreadKey, threadKey } from '../comments/threads.ts';
import { parsePatch } from './patch.ts';
import { buildFileRows } from './rows.ts';
import type { FileView } from './rows.ts';

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

function thread(line: number, side: CommentSide = 'new'): CommentThread {
  return { key: threadKey(PATH, side, line), path: PATH, side, line, startLine: null, comments: [] };
}

describe('buildFileRows with comments', () => {
  it('places a unified thread row directly after the commented line', () => {
    const rows = buildFileRows(view(), 'unified', [thread(2)]);

    expect(rows[2]?.kind).toBe('line');
    expect(rows[2]).toMatchObject({ kind: 'line', line: { newNo: 2 } });
    expect(rows[3]).toEqual({ kind: 'thread', threadKey: threadKey(PATH, 'new', 2) });
  });

  it('places a split thread row after the pair containing the line', () => {
    const rows = buildFileRows(view(), 'split', [thread(2)]);

    expect(rows[2]).toMatchObject({ kind: 'split', right: { newNo: 2 } });
    expect(rows[3]).toEqual({ kind: 'thread', threadKey: threadKey(PATH, 'new', 2) });
  });

  it('keeps every thread after its own line when several lines are commented', () => {
    const rows = buildFileRows(view(), 'unified', [thread(1), thread(3)]);

    expect(rows.map((row) => row.kind)).toEqual(['file', 'line', 'thread', 'line', 'line', 'thread', 'gap']);
    expect(rows[2]).toEqual({ kind: 'thread', threadKey: threadKey(PATH, 'new', 1) });
    expect(rows[5]).toEqual({ kind: 'thread', threadKey: threadKey(PATH, 'new', 3) });
  });

  it('collects comments outside the shown hunks into one row under the file header', () => {
    const rows = buildFileRows(view(), 'unified', [thread(99), thread(100)]);

    expect(rows[1]).toEqual({ kind: 'thread', threadKey: outsideThreadKey(PATH) });
    expect(rows.slice(2).some((row) => row.kind === 'thread')).toBe(false);
  });

  it('places a composer after its line and keeps the range', () => {
    const rows = buildFileRows(view(), 'unified', [], { side: 'new', line: 3, startLine: 2 });

    expect(rows[3]).toMatchObject({ kind: 'line', line: { newNo: 3 } });
    expect(rows[4]).toEqual({ kind: 'composer', side: 'new', line: 3, startLine: 2 });
  });
});
