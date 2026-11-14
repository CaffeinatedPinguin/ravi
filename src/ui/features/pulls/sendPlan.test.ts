import { describe, expect, it } from 'vitest';
import type { ReviewComment, ReviewDocument } from '../../../shared/review.ts';
import {
  approveDisabledReason,
  buildSendPlan,
  countDrafts,
  planText,
  targetLabel,
} from './sendPlan.ts';

function comment(overrides: Partial<ReviewComment> & Pick<ReviewComment, 'id'>): ReviewComment {
  return {
    parentId: null,
    path: 'src/a.ts',
    side: 'new',
    line: 3,
    startLine: null,
    body: 'Looks fine',
    author: null,
    state: 'draft',
    createdAt: '2026-11-14T10:00:00.000Z',
    updatedAt: '2026-11-14T10:00:00.000Z',
    codeContext: null,
    outdated: false,
    ...overrides,
  };
}

function document(comments: ReviewComment[]): ReviewDocument {
  return {
    version: 1,
    target: { kind: 'pullRequest', host: 'github.com', project: 'acme/api', number: 123, forge: 'github' },
    baseSha: 'base',
    headSha: 'head',
    action: null,
    summary: null,
    comments,
  };
}

describe('countDrafts', () => {
  it('counts new comments, replies, edits and deletes and ignores published comments', () => {
    const counts = countDrafts([
      comment({ id: 'c1', body: 'New inline' }),
      comment({ id: 'c2', path: null, line: null, body: 'General' }),
      comment({ id: 'r1', parentId: 'c1', body: 'Reply' }),
      comment({ id: 'r2', remoteThreadId: 'thread-1', path: null, line: null, body: 'Remote reply' }),
      comment({ id: 'e1', pendingAction: 'edit', remoteCommentId: '55', path: null, line: null, body: 'Changed' }),
      comment({ id: 'd1', pendingAction: 'delete', remoteCommentId: '56', path: null, line: null, body: '' }),
      comment({ id: 'p1', state: 'published', body: 'Already on the forge' }),
    ]);

    expect(counts).toEqual({ comment: 2, reply: 2, edit: 1, delete: 1, total: 6 });
  });
});

describe('approveDisabledReason', () => {
  it('allows approving someone else’s open pull request', () => {
    expect(approveDisabledReason({ author: 'octocat', state: 'open' }, 'me')).toBeNull();
  });

  it('refuses the user’s own pull request', () => {
    expect(approveDisabledReason({ author: 'Octocat', state: 'open' }, 'octocat')).toBe(
      'You cannot approve your own pull request',
    );
  });

  it('refuses a closed or merged pull request', () => {
    expect(approveDisabledReason({ author: 'octocat', state: 'closed' }, 'me')).toBe(
      'Only an open pull request can be approved',
    );
  });
});

describe('buildSendPlan', () => {
  it('describes the verdict, target, counts and the first line of each draft', () => {
    const plan = buildSendPlan(
      document([
        comment({ id: 'c1', path: 'src/a.ts', line: 12, body: 'First line\nsecond line' }),
        comment({ id: 'r1', parentId: 'c1', body: 'A reply' }),
      ]),
      targetLabel('acme/api', 123, 'github.com'),
      'requestChanges',
      'Please add tests',
    );

    expect(plan.target).toBe('acme/api #123 on github.com');
    expect(plan.counts).toEqual({ comment: 1, reply: 1, edit: 0, delete: 0, total: 2 });
    expect(plan.drafts).toEqual([
      { id: 'c1', kind: 'comment', where: 'src/a.ts:12', preview: 'First line' },
      { id: 'r1', kind: 'reply', where: 'src/a.ts:3', preview: 'A reply' },
    ]);

    const text = planText(plan);
    expect(text).toContain('Request changes — acme/api #123 on github.com');
    expect(text).toContain('Summary: Please add tests');
    expect(text).toContain('2 drafts: 1 comment, 1 reply, 0 edits, 0 deletions');
    expect(text).toContain('comment: src/a.ts:12 — First line');
  });
});
