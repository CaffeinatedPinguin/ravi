import { describe, expect, it } from 'vitest';
import type { DiffFile, DiffSummary } from '../../../shared/api.ts';
import { DiffSession } from './session.ts';
import { filesToRequest } from './visible.ts';

const PRELOAD = 8;

function summary(count: number): DiffSummary {
  const files: DiffFile[] = Array.from({ length: count }, (_, index) => ({
    path: `dir/file-${index}.ts`,
    oldPath: null,
    status: 'modified',
    additions: 3,
    deletions: 1,
    binary: false,
  }));
  return { files, additions: count * 3, deletions: count };
}

function session(count: number): DiffSession {
  return new DiffSession('repo', { target: { kind: 'uncommitted' }, ignoreWhitespace: false, includeUntracked: false }, summary(count), 'unified');
}

describe('filesToRequest', () => {
  it('requests the files at the top when the measurement cache is still empty', () => {
    // This is the first render after the summary: `virtualizer.getVirtualItems()` returned [].
    const files = filesToRequest(session(20), [], PRELOAD);

    expect(files).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('maps the visible rows to every file they touch plus the preload margin', () => {
    // Every unloaded file renders two rows (header + loading notice), so rows 0..9 cover files 0..4.
    const files = filesToRequest(session(30), [{ index: 0 }, { index: 9 }], PRELOAD);

    expect(files).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('stays inside the file list and copes with an empty diff', () => {
    expect(filesToRequest(session(10), [{ index: 0 }, { index: 18 }], PRELOAD)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(filesToRequest(session(0), [], PRELOAD)).toEqual([]);
  });
});
