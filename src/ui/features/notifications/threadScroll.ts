/**
 * Drives the diff view for a `?thread=<id>` link. Kept free of React and the browser so the
 * virtualizer call and the fallback are testable; the hook only adds tab switching and focus.
 */
import type { Thread } from '../../../shared/forge.ts';
import { locateThread } from './threadTarget.ts';
import type { ThreadRowSource } from './threadTarget.ts';

export type ThreadScrollHandle = {
  scrollToRow?: (rowIndex: number) => void;
  scrollToFile: (fileIndex: number) => void;
};

export type ThreadRowSession = ThreadRowSource & { files: readonly { path: string }[] };

export type ThreadScrollResult = 'scrolled' | 'opened' | 'conversation' | 'missing';

/**
 * Scrolls to the exact row when the session already knows it. A thread whose file rows are not
 * ready yet still gets the reader to its file, which is the best a notification can do.
 */
export function scrollToThread(
  threadId: string,
  threads: readonly Thread[],
  session: ThreadRowSession | null,
  handle: ThreadScrollHandle | null,
): ThreadScrollResult {
  const thread = threads.find((candidate) => candidate.id === threadId);
  if (thread === undefined || handle === null) {
    return 'missing';
  }

  const target = locateThread(thread, session);
  if (target?.kind === 'conversation') {
    return 'conversation';
  }
  if (target !== null) {
    if (handle.scrollToRow !== undefined) {
      handle.scrollToRow(target.rowIndex);
      return 'scrolled';
    }
    handle.scrollToFile(target.fileIndex);
    return 'opened';
  }

  const fileIndex = thread.path === null ? -1 : (session?.files ?? []).findIndex((file) => file.path === thread.path);
  if (fileIndex < 0) {
    return 'missing';
  }
  handle.scrollToFile(fileIndex);
  return 'opened';
}
