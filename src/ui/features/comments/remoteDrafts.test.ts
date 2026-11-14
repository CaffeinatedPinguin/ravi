import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Thread } from '../../../shared/forge.ts';
import type { ReviewComment, ReviewDocument, ReviewTarget } from '../../../shared/review.ts';
import { remoteDraftState } from './remoteDrafts.ts';
import { ReviewStore } from './reviewStore.ts';
import { RemoteThread } from './Thread.tsx';

const target: ReviewTarget = { kind: 'local', repoPath: 'C:/repo', target: 'uncommitted' };

function draft(overrides: Partial<ReviewComment> & Pick<ReviewComment, 'id'>): ReviewComment {
  return {
    parentId: null,
    path: null,
    side: 'new',
    line: null,
    startLine: null,
    body: '',
    author: null,
    state: 'draft',
    createdAt: '2026-11-14T10:00:00.000Z',
    updatedAt: '2026-11-14T10:00:00.000Z',
    codeContext: null,
    outdated: false,
    ...overrides,
  };
}

const thread: Thread = {
  id: 'thread-1',
  path: 'src/a.ts',
  side: 'new',
  line: 3,
  startLine: null,
  outdated: false,
  resolved: false,
  comments: [
    {
      id: 'remote-1',
      author: 'me',
      body: 'Original remote text',
      createdAt: '2026-11-14T09:00:00.000Z',
      updatedAt: '2026-11-14T09:00:00.000Z',
      canEdit: true,
    },
  ],
};

function document(comments: ReviewComment[]): ReviewDocument {
  return {
    version: 1,
    target: { kind: 'pullRequest', host: 'github.com', project: 'acme/api', number: 1, forge: 'github' },
    baseSha: 'base',
    headSha: 'head',
    action: null,
    summary: null,
    comments,
  };
}

function storeWith(comments: ReviewComment[]): ReviewStore {
  const store = new ReviewStore('a1b2c3d4', target);
  store.applyServerDocument(document(comments));
  return store;
}

describe('remoteDraftState', () => {
  it('separates replies, edits and deletions aimed at the same forge thread', () => {
    const comments = [
      draft({ id: 'reply', remoteThreadId: 'thread-1', body: 'Answer' }),
      draft({ id: 'edit', remoteThreadId: 'thread-1', remoteCommentId: 'remote-1', pendingAction: 'edit', body: 'New text' }),
      draft({ id: 'delete', remoteThreadId: 'thread-1', remoteCommentId: 'remote-1', pendingAction: 'delete' }),
      draft({ id: 'other', remoteThreadId: 'another-thread', remoteCommentId: 'remote-9', pendingAction: 'edit' }),
    ];

    const state = remoteDraftState(comments, thread);

    expect(state.replies.map((comment) => comment.id)).toEqual(['reply']);
    expect(state.edits.get('remote-1')?.body).toBe('New text');
    expect(state.deletes.get('remote-1')?.id).toBe('delete');
    expect(state.edits.has('remote-9')).toBe(false);
  });
});

describe('RemoteThread pending drafts', () => {
  it('renders an edit draft as a pending change under the original comment', () => {
    const store = storeWith([
      draft({ id: 'edit', remoteThreadId: 'thread-1', remoteCommentId: 'remote-1', pendingAction: 'edit', body: 'Edited body' }),
    ]);

    const html = renderToStaticMarkup(createElement(RemoteThread, { thread, store }));

    expect(html).toContain('Original remote text');
    expect(html).toContain('Edit pending — it will be sent with your review');
    expect(html).toContain('Edited body');
  });

  it('strikes through a remote comment whose deletion is waiting and offers Undo', () => {
    const store = storeWith([
      draft({ id: 'delete', remoteThreadId: 'thread-1', remoteCommentId: 'remote-1', pendingAction: 'delete' }),
    ]);

    const html = renderToStaticMarkup(createElement(RemoteThread, { thread, store }));

    expect(html).toContain('<s>Original remote text</s>');
    expect(html).toContain('Deletion pending — it will be sent with your review');
    expect(html).toContain('Undo');
  });

  it('marks a reply draft as pending and keeps it out of the original comment body', () => {
    const store = storeWith([
      draft({ id: 'reply', remoteThreadId: 'thread-1', body: 'Draft reply' }),
    ]);

    const html = renderToStaticMarkup(createElement(RemoteThread, { thread, store }));

    expect(html).toContain('Reply pending — it will be sent with your review');
    expect(html).toContain('Draft reply');
    expect(html).not.toContain('<s>');
  });
});
