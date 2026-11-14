/**
 * Pure rules for the explicit Send flow: what counts as a draft, when Approve is allowed and what
 * the confirmation promises to send. Keeping them out of the components makes the destructive path
 * testable without a browser.
 */
import type { PullRequest, ReviewAction } from '../../../shared/forge.ts';
import type { ReviewComment, ReviewDocument } from '../../../shared/review.ts';

export type DraftKind = 'comment' | 'reply' | 'edit' | 'delete';

export type DraftCounts = {
  comment: number;
  reply: number;
  edit: number;
  delete: number;
  total: number;
};

export type SendPlanDraft = {
  id: string;
  kind: DraftKind;
  /** `path:line` for an inline draft, `Conversation` for a pull-request comment. */
  where: string;
  /** First non-empty line of the new body, trimmed to a readable length. */
  preview: string;
};

export type SendPlan = {
  target: string;
  action: ReviewAction | null;
  summary: string | null;
  counts: DraftCounts;
  drafts: SendPlanDraft[];
};

const PREVIEW_LENGTH = 90;

export function draftKind(comment: ReviewComment): DraftKind {
  if (comment.pendingAction === 'edit') {
    return 'edit';
  }
  if (comment.pendingAction === 'delete') {
    return 'delete';
  }
  if (comment.parentId !== null || (comment.remoteThreadId ?? null) !== null) {
    return 'reply';
  }
  return 'comment';
}

export function isSendableDraft(comment: ReviewComment): boolean {
  return comment.state === 'draft';
}

/** Drafts the document will send, in document order. Remote edit/delete drafts live here too. */
export function sendableDrafts(document: ReviewDocument): ReviewComment[] {
  return document.comments.filter(isSendableDraft);
}

export function countDrafts(comments: readonly ReviewComment[]): DraftCounts {
  const counts: DraftCounts = { comment: 0, reply: 0, edit: 0, delete: 0, total: 0 };
  for (const comment of comments) {
    if (!isSendableDraft(comment)) {
      continue;
    }
    counts[draftKind(comment)] += 1;
    counts.total += 1;
  }
  return counts;
}

/** Why the Approve control is unavailable, or null when it may be pressed. */
export function approveDisabledReason(
  pullRequest: Pick<PullRequest, 'author' | 'state'>,
  currentUser: string,
): string | null {
  if (pullRequest.state !== 'open') {
    return 'Only an open pull request can be approved';
  }
  if (pullRequest.author.toLowerCase() === currentUser.toLowerCase()) {
    return 'You cannot approve your own pull request';
  }
  return null;
}

/** The verdict outcome the send route reports next to the per-draft results. */
export type VerdictApproval = { action: ReviewAction; ok: boolean; error?: string } | null;

/** A failed approve/request-changes kept on screen until a retry succeeds or the user dismisses it. */
export type VerdictFailure = { action: ReviewAction; error: string };

/**
 * Persistent notice state. Only verdicts get one: a failed comment still has its per-draft error.
 * A successful response for the same verdict clears it, which is also how a retry disappears.
 */
export function nextVerdictFailure(current: VerdictFailure | null, approval: VerdictApproval): VerdictFailure | null {
  if (approval === null || approval.action === 'comment') {
    return current;
  }
  if (approval.ok) {
    return null;
  }
  return { action: approval.action, error: approval.error ?? 'The forge did not report the review outcome' };
}

export function verdictFailureTitle(failure: VerdictFailure): string {
  return failure.action === 'requestChanges' ? 'Request changes failed' : 'Approve failed';
}

export function retryVerdictLabel(action: ReviewAction): string {
  return action === 'requestChanges' ? 'Retry request changes' : 'Retry approve';
}

export function verdictLabel(action: ReviewAction | null): string {
  switch (action) {
    case 'approve':
      return 'Approve';
    case 'requestChanges':
      return 'Request changes';
    case 'comment':
      return 'Comment';
    default:
      return 'No verdict';
  }
}

/** The confirmation's target line, e.g. `acme/api #123 on github.com`. */
export function targetLabel(project: string, number: number, host: string): string {
  return `${project} #${number} on ${host}`;
}

export function buildSendPlan(
  document: ReviewDocument,
  target: string,
  action: ReviewAction | null,
  summary: string | null,
): SendPlan {
  const drafts = sendableDrafts(document).map((comment): SendPlanDraft => {
    const where =
      comment.path === null ? 'Conversation' : `${comment.path}:${comment.line ?? '?'}`;
    return { id: comment.id, kind: draftKind(comment), where, preview: firstLine(comment.body) };
  });
  return {
    target,
    action,
    summary: summary !== null && summary.trim() === '' ? null : summary,
    counts: countDrafts(document.comments),
    drafts,
  };
}

/** Plain-text rendering of a plan; the dialog shows the same facts with controls around them. */
export function planText(plan: SendPlan): string {
  const lines = [`${verdictLabel(plan.action)} — ${plan.target}`];
  if (plan.summary !== null) {
    lines.push(`Summary: ${firstLine(plan.summary)}`);
  }
  const { comment, reply, edit, delete: deleted, total } = plan.counts;
  lines.push(
    `${total} draft${total === 1 ? '' : 's'}: ${comment} comment${comment === 1 ? '' : 's'}, ` +
      `${reply} repl${reply === 1 ? 'y' : 'ies'}, ${edit} edit${edit === 1 ? '' : 's'}, ` +
      `${deleted} deletion${deleted === 1 ? '' : 's'}`,
  );
  for (const draft of plan.drafts) {
    lines.push(`${draft.kind}: ${draft.where} — ${draft.preview}`);
  }
  return lines.join('\n');
}

function firstLine(body: string): string {
  const line = body
    .split('\n')
    .map((part) => part.trim())
    .find((part) => part !== '');
  if (line === undefined) {
    return '(empty)';
  }
  return line.length > PREVIEW_LENGTH ? `${line.slice(0, PREVIEW_LENGTH - 1)}…` : line;
}
