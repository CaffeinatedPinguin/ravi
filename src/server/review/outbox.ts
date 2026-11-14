/**
 * Turns the drafts of a review into the operations a forge can send.
 *
 * Only this module (and `api/send.ts`) decides what reaches a forge. Drafts that reply to another
 * local draft cannot be sent as replies because the parent comment does not exist on the forge yet,
 * so their text is folded into the parent's body as a quoted follow-up; the whole thread then goes
 * out as one comment. Everything else maps one draft to one `DraftOperation`.
 */
import type { ReviewComment, ReviewDocument } from '../../shared/review.ts';
import type { DraftOperation } from '../../shared/forge.ts';
import type { Patches } from '../../shared/api.ts';
import { counterpart } from './line-map.ts';

type CommentOperation = Extract<DraftOperation, { op: 'comment' }>;

export function buildOperations(document: ReviewDocument, patches: Patches): DraftOperation[] {
  const drafts = document.comments.filter((comment) => comment.state === 'draft');
  const draftIds = new Set(drafts.map((comment) => comment.id));
  // All comments, so a reply can inherit the thread of a published parent.
  const byId = new Map(document.comments.map((comment) => [comment.id, comment]));
  const effectiveBodies = new Map<string, string>();

  /** A draft's body plus every local reply below it, as nested quotes. */
  const bodyOf = (comment: ReviewComment): string => {
    const cached = effectiveBodies.get(comment.id);
    if (cached !== undefined) {
      return cached;
    }
    let body = comment.body;
    for (const child of drafts) {
      if (child.parentId === comment.id) {
        body = fold(body, bodyOf(child));
      }
    }
    effectiveBodies.set(comment.id, body);
    return body;
  };

  const operations: DraftOperation[] = [];
  for (const comment of drafts) {
    // A reply to a local draft travels inside its parent; emitting it separately would fail.
    if (comment.parentId !== null && draftIds.has(comment.parentId)) {
      continue;
    }
    const operation = operationFor(comment, bodyOf(comment), byId, patches);
    if (operation !== null) {
      operations.push(operation);
    }
  }
  return operations;
}

function operationFor(
  comment: ReviewComment,
  body: string,
  byId: Map<string, ReviewComment>,
  patches: Patches,
): DraftOperation | null {
  const remoteCommentId = comment.remoteCommentId ?? null;
  if (comment.pendingAction === 'edit' && remoteCommentId !== null) {
    return { op: 'edit', draftId: comment.id, commentId: remoteCommentId, body };
  }
  if (comment.pendingAction === 'delete' && remoteCommentId !== null) {
    return { op: 'delete', draftId: comment.id, commentId: remoteCommentId };
  }

  const threadId = comment.remoteThreadId ?? threadOfParent(comment, byId);
  if (threadId !== null) {
    return { op: 'reply', draftId: comment.id, threadId, body };
  }
  if (comment.path === null) {
    return { op: 'prComment', draftId: comment.id, body };
  }
  if (comment.line === null) {
    // Inline comments need a line; a path without one cannot be placed on the forge.
    return null;
  }
  return commentOperation(comment, body, comment.path, comment.line, patches[comment.path]);
}

/** A reply can inherit the thread of its parent when the UI stored only the parent link. */
function threadOfParent(comment: ReviewComment, byId: Map<string, ReviewComment>): string | null {
  if (comment.parentId === null) {
    return null;
  }
  const parent = byId.get(comment.parentId);
  return parent?.remoteThreadId ?? null;
}

function commentOperation(
  comment: ReviewComment,
  body: string,
  path: string,
  line: number,
  patch: string | undefined,
): CommentOperation {
  const operation: CommentOperation = {
    op: 'comment',
    draftId: comment.id,
    path,
    side: comment.side,
    line,
    startLine: comment.startLine,
    body,
  };
  if (patch === undefined) {
    // Without the patch the forge derives the counter-line from `side` + `line`.
    return operation;
  }

  const oppositeLine = counterpart(patch, comment.side, operation.line);
  operation.oldLine = comment.side === 'old' ? operation.line : oppositeLine;
  operation.newLine = comment.side === 'new' ? operation.line : oppositeLine;

  if (comment.startLine === null) {
    operation.startOldLine = null;
    operation.startNewLine = null;
  } else {
    const oppositeStart = counterpart(patch, comment.side, comment.startLine);
    operation.startOldLine = comment.side === 'old' ? comment.startLine : oppositeStart;
    operation.startNewLine = comment.side === 'new' ? comment.startLine : oppositeStart;
  }
  return operation;
}

/** Prefixes every line with `>` so the reply reads as a quote inside the parent comment. */
function quote(body: string): string {
  return body
    .split('\n')
    .map((line) => (line === '' ? '>' : `> ${line}`))
    .join('\n');
}

function fold(parent: string, reply: string): string {
  return parent === '' ? quote(reply) : `${parent}\n\n${quote(reply)}`;
}
