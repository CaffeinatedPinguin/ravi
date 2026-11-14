/** Drafts that target a forge thread: a reply, an edit of one remote comment, or its deletion. */
import type { Thread } from '../../../shared/forge.ts';
import type { ReviewComment } from '../../../shared/review.ts';

export type RemoteDraftState = {
  /** Replies waiting to be sent under the thread root. */
  replies: ReviewComment[];
  /** At most one edit draft per remote comment id. */
  edits: Map<string, ReviewComment>;
  /** At most one delete draft per remote comment id. */
  deletes: Map<string, ReviewComment>;
};

export function remoteDraftState(
  comments: readonly ReviewComment[],
  thread: Thread,
): RemoteDraftState {
  const remoteIds = new Set(thread.comments.map((comment) => comment.id));
  const state: RemoteDraftState = { replies: [], edits: new Map(), deletes: new Map() };

  for (const comment of comments) {
    if (comment.state !== 'draft') {
      continue;
    }
    const remoteId = comment.remoteCommentId ?? null;
    if (comment.pendingAction === 'edit' && remoteId !== null) {
      if (remoteIds.has(remoteId)) {
        state.edits.set(remoteId, comment);
      }
      continue;
    }
    if (comment.pendingAction === 'delete' && remoteId !== null) {
      if (remoteIds.has(remoteId)) {
        state.deletes.set(remoteId, comment);
      }
      continue;
    }
    if (comment.remoteThreadId === thread.id) {
      state.replies.push(comment);
    }
  }
  return state;
}

/** Drafts aimed at a forge object never appear in the local Notes/diff grouping. */
export function isRemoteDraft(comment: ReviewComment): boolean {
  return (comment.remoteThreadId ?? null) !== null || (comment.remoteCommentId ?? null) !== null;
}
