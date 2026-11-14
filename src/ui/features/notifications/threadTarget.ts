/**
 * Where a notification link should land. The diff is virtualized, so a thread row may not be in
 * the DOM at all; the caller needs its row index for `scrollToIndex`, not just the file.
 *
 * Kept as a pure lookup over the session's public row API so it can be tested without React,
 * a browser or a loaded patch. A pull-request-level thread has no row: it lives in Conversation.
 */
import type { Thread } from '../../../shared/forge.ts';
import type { CommentThread } from '../comments/threads.ts';
import type { Row } from '../diff/rows.ts';

export type ThreadRowSource = {
  rowCount: number;
  rowAt(index: number): { fileIndex: number; row: Row } | null;
  threadsOf(key: string): readonly CommentThread[];
};

export type ThreadTarget =
  | { kind: 'conversation' }
  | { kind: 'row'; rowIndex: number; fileIndex: number };

/**
 * Scans thread rows in order. An "outside the shown lines" row holds every invisible thread of a
 * file, so matching through `threadsOf` finds those too without rebuilding the row layout here.
 */
export function locateThread(thread: Thread, source: ThreadRowSource | null): ThreadTarget | null {
  if (thread.path === null) {
    return { kind: 'conversation' };
  }
  if (source === null) {
    return null;
  }
  for (let index = 0; index < source.rowCount; index += 1) {
    const at = source.rowAt(index);
    if (at === null || at.row.kind !== 'thread') {
      continue;
    }
    const found = source.threadsOf(at.row.threadKey).some((candidate) => candidate.remote?.id === thread.id);
    if (found) {
      return { kind: 'row', rowIndex: index, fileIndex: at.fileIndex };
    }
  }
  return null;
}
