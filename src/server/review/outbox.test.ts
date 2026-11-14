import { describe, expect, it } from 'vitest';
import type { DraftOperation } from '../../shared/forge.ts';
import type { ReviewComment, ReviewDocument } from '../../shared/review.ts';
import { buildOperations } from './outbox.ts';

const PATCH = `diff --git a/f.txt b/f.txt
--- a/f.txt
+++ b/f.txt
@@ -5,4 +5,5 @@
 a
-b
+B
+B2
 c
 d
@@ -15,3 +16,3 @@
 e
-f
+F
 g
`;

function comment(overrides: Partial<ReviewComment> & Pick<ReviewComment, 'id' | 'body'>): ReviewComment {
  return {
    parentId: null,
    path: null,
    side: 'new',
    line: null,
    startLine: null,
    author: null,
    state: 'draft',
    createdAt: '2026-11-14T10:00:00.000Z',
    updatedAt: '2026-11-14T10:00:00.000Z',
    codeContext: null,
    outdated: false,
    ...overrides,
  };
}

function documentOf(comments: ReviewComment[]): ReviewDocument {
  return {
    version: 1,
    target: { kind: 'pullRequest', host: 'github.com', project: 'acme/api', number: 7, forge: 'github' },
    baseSha: 'base',
    headSha: 'head',
    action: 'comment',
    summary: 'Summary',
    comments,
  };
}

describe('buildOperations', () => {
  it('maps every kind of draft to its forge operation and folds local replies', () => {
    const document = documentOf([
      comment({ id: 'd1', path: 'f.txt', side: 'new', line: 8, body: 'looks odd' }),
      comment({ id: 'd1-reply', parentId: 'd1', path: 'f.txt', side: 'new', line: 8, body: 'Agreed' }),
      comment({ id: 'd2', path: 'f.txt', side: 'new', line: 7, startLine: 6, body: 'Both lines' }),
      comment({ id: 'd3', parentId: 'remote-1', remoteThreadId: 'T1', body: 'Thanks' }),
      comment({ id: 'd4', body: 'General note' }),
      comment({ id: 'd5', path: 'f.txt', pendingAction: 'edit', remoteCommentId: 'c-9', body: 'New text' }),
      comment({ id: 'd6', path: 'f.txt', pendingAction: 'delete', remoteCommentId: 'c-10', body: '' }),
    ]);

    const operations = buildOperations(document, { 'f.txt': PATCH });

    const expected: DraftOperation[] = [
      {
        op: 'comment',
        draftId: 'd1',
        path: 'f.txt',
        side: 'new',
        line: 8,
        startLine: null,
        oldLine: 7,
        newLine: 8,
        startOldLine: null,
        startNewLine: null,
        body: 'looks odd\n\n> Agreed',
      },
      {
        op: 'comment',
        draftId: 'd2',
        path: 'f.txt',
        side: 'new',
        line: 7,
        startLine: 6,
        oldLine: null,
        newLine: 7,
        startOldLine: null,
        startNewLine: 6,
        body: 'Both lines',
      },
      { op: 'reply', draftId: 'd3', threadId: 'T1', body: 'Thanks' },
      { op: 'prComment', draftId: 'd4', body: 'General note' },
      { op: 'edit', draftId: 'd5', commentId: 'c-9', body: 'New text' },
      { op: 'delete', draftId: 'd6', commentId: 'c-10' },
    ];
    expect(operations).toEqual(expected);
  });

  it('sends only drafts and leaves published comments alone', () => {
    const operations = buildOperations(
      documentOf([
        comment({ id: 'old', state: 'published', path: 'f.txt', line: 5, body: 'already there' }),
        comment({ id: 'd1', path: 'f.txt', side: 'new', line: 5, body: 'new' }),
      ]),
      { 'f.txt': PATCH },
    );

    expect(operations).toEqual([
      {
        op: 'comment',
        draftId: 'd1',
        path: 'f.txt',
        side: 'new',
        line: 5,
        startLine: null,
        oldLine: 5,
        newLine: 5,
        startOldLine: null,
        startNewLine: null,
        body: 'new',
      },
    ]);
  });

  it('leaves the counter-lines to the forge when no patch is available', () => {
    const operations = buildOperations(documentOf([comment({ id: 'd1', path: 'f.txt', line: 8, body: 'x' })]), {});

    expect(operations).toEqual([
      { op: 'comment', draftId: 'd1', path: 'f.txt', side: 'new', line: 8, startLine: null, body: 'x' },
    ]);
  });
});
