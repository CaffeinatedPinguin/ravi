/**
 * Pure helpers that turn the flat comment list of a review into threads.
 *
 * A thread is anchored to one path, side and line; the UI inserts it after that line. The key is
 * the same one a row carries, so the diff never has to search the document while rendering.
 */
import type { Thread } from '../../../shared/forge.ts';
import type { CommentSide, ReviewComment } from '../../../shared/review.ts';

export type CommentThread = {
  key: string;
  path: string;
  side: CommentSide;
  /** Last line of the commented range; the thread row is anchored after it. */
  line: number;
  startLine: number | null;
  /** Root comment first, then its replies in document order. Empty for a forge-only thread. */
  comments: ReviewComment[];
  /** A read-only thread read from the forge; rendered next to `comments`, never edited locally. */
  remote?: Thread;
};

/** NUL cannot appear in a path, so it safely separates the parts of a key. */
const SEPARATOR = '\u0000';
const OUTSIDE_SUFFIX = `${SEPARATOR}outside`;

export function threadKey(path: string, side: CommentSide, line: number): string {
  return `${path}${SEPARATOR}${side}${SEPARATOR}${line}`;
}

/** One synthetic thread holding every comment whose line is not visible in the diff. */
export function outsideThreadKey(path: string): string {
  return `${path}${OUTSIDE_SUFFIX}`;
}

export function isOutsideThreadKey(key: string): boolean {
  return key.endsWith(OUTSIDE_SUFFIX);
}

export function pathFromOutsideThreadKey(key: string): string {
  return key.slice(0, -OUTSIDE_SUFFIX.length);
}

export function groupThreads(comments: readonly ReviewComment[]): CommentThread[] {
  const threads: CommentThread[] = [];
  const byKey = new Map<string, CommentThread>();
  const keyByComment = new Map<string, string>();
  const pending: ReviewComment[] = [];

  for (const comment of comments) {
    // A review-level comment has no place in the diff.
    if (comment.path === null || comment.line === null) {
      continue;
    }
    if (comment.parentId !== null) {
      const parentKey = keyByComment.get(comment.parentId);
      const thread = parentKey === undefined ? undefined : byKey.get(parentKey);
      if (thread) {
        thread.comments.push(comment);
        keyByComment.set(comment.id, thread.key);
        continue;
      }
      // A reply before its root (or a broken parent link) is resolved after the ordered pass.
      pending.push(comment);
      continue;
    }
    let thread = byKey.get(threadKey(comment.path, comment.side, comment.line));
    if (!thread) {
      thread = {
        key: threadKey(comment.path, comment.side, comment.line),
        path: comment.path,
        side: comment.side,
        line: comment.line,
        startLine: comment.startLine,
        comments: [],
      };
      byKey.set(thread.key, thread);
      threads.push(thread);
    }
    thread.comments.push(comment);
    keyByComment.set(comment.id, thread.key);
  }

  // Replies whose parent was not seen yet still belong to the thread that appears later.
  for (const comment of pending) {
    const parentKey = comment.parentId === null ? undefined : keyByComment.get(comment.parentId);
    const thread = parentKey === undefined ? undefined : byKey.get(parentKey);
    if (thread) {
      thread.comments.push(comment);
      keyByComment.set(comment.id, thread.key);
      continue;
    }
    if (comment.path === null || comment.line === null) {
      continue;
    }
    let orphan = byKey.get(threadKey(comment.path, comment.side, comment.line));
    if (!orphan) {
      orphan = {
        key: threadKey(comment.path, comment.side, comment.line),
        path: comment.path,
        side: comment.side,
        line: comment.line,
        startLine: comment.startLine,
        comments: [],
      };
      byKey.set(orphan.key, orphan);
      threads.push(orphan);
    }
    orphan.comments.push(comment);
  }

  // A reply before its root still comes after the root, but replies keep their document order.
  const position = new Map(comments.map((comment, index) => [comment.id, index]));
  for (const thread of threads) {
    thread.comments.sort((left, right) => {
      const leftRoot = left.parentId === null ? 0 : 1;
      const rightRoot = right.parentId === null ? 0 : 1;
      if (leftRoot !== rightRoot) {
        return leftRoot - rightRoot;
      }
      return (position.get(left.id) ?? 0) - (position.get(right.id) ?? 0);
    });
  }

  return threads;
}

/** Splits threads into the ones that can sit inline and the ones the file header must collect. */
export function partitionThreads(
  threads: readonly CommentThread[],
  visibleKeys: ReadonlySet<string>,
): { inline: CommentThread[]; outside: CommentThread[] } {
  const inline: CommentThread[] = [];
  const outside: CommentThread[] = [];
  for (const thread of threads) {
    (visibleKeys.has(thread.key) ? inline : outside).push(thread);
  }
  return { inline, outside };
}

/** Compact relative time for a comment header; no library for four buckets. */
export function relativeTime(iso: string, now = Date.now()): string {
  const elapsed = now - Date.parse(iso);
  if (Number.isNaN(elapsed)) {
    return '';
  }
  const seconds = Math.max(0, Math.floor(elapsed / 1000));
  if (seconds < 60) {
    return 'just now';
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes} min ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours} h ago`;
  }
  return `${Math.floor(hours / 24)} d ago`;
}
