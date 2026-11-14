/**
 * Places forge threads in the diff without copying the row builder.
 *
 * A remote thread is converted to the same `CommentThread` shape the local comments use, with a
 * `remote` payload. The existing `buildFileRows` then decides where it goes: a visible anchor keeps
 * it inline, anything without one (outdated, file-level, line outside the hunks) lands in the
 * "outside the shown lines" group. Threads on the pull request as a whole belong to Conversation.
 */
import type { Thread } from '../../../shared/forge.ts';
import type { CommentThread } from '../comments/threads.ts';
import { outsideThreadKey, threadKey } from '../comments/threads.ts';

export function remoteThreadsForPath(threads: readonly Thread[], path: string): CommentThread[] {
  return threads
    .filter((thread) => thread.path === path)
    .map((thread) => {
      // An outdated thread has no line at the head any more, and a file-level comment has none at
      // all; both go to the outside group instead of pretending to anchor at a real line.
      const anchorless = thread.outdated || thread.line === null;
      return {
        key: anchorless ? outsideThreadKey(path) : threadKey(path, thread.side, thread.line ?? 1),
        path,
        side: thread.side,
        // `buildFileRows` only reads `line` through the key; 1 keeps the shape honest.
        line: thread.line ?? 1,
        startLine: thread.startLine,
        comments: [],
        remote: thread,
      };
    });
}

/** Only path-less threads are pull request conversation; file threads stay in Files changed. */
export function conversationThreads(threads: readonly Thread[]): Thread[] {
  return threads.filter((thread) => thread.path === null);
}
