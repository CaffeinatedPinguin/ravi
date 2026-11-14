import { describe, expect, it } from 'vitest';
import type { DraftOperation, PullRequest, RepoRef } from '../../shared/forge.ts';
import { describeForgeContract } from './contract.ts';
import type { ForgeHost } from './forge.ts';
import { createGitHubForge } from './github.ts';
import { createForgeHttp } from './http.ts';
import type { FakeRoute } from './testing.ts';
import { fakeFetch } from './testing.ts';

const API = 'https://api.github.com';
const TOKEN = 'test-token-123';
const repo: RepoRef = { host: 'github.com', project: 'acme/api' };

const host: ForgeHost = {
  host: 'github.com',
  kind: 'github',
  apiUrl: API,
  webUrl: 'https://github.com',
  tokenEnv: 'GITHUB_TOKEN',
  auth: () => undefined,
};

function make(routes: Record<string, FakeRoute>) {
  const fake = fakeFetch(routes);
  const http = createForgeHttp({
    apiUrl: API,
    auth: (headers) => {
      headers.set('authorization', `Bearer ${TOKEN}`);
      headers.set('x-github-api-version', '2026-03-10');
      headers.set('accept', 'application/vnd.github+json');
    },
    fetchImpl: fake,
  });
  return { forge: createGitHubForge(host, http), fake };
}

const openPull = {
  number: 1,
  title: 'Add search',
  user: { login: 'Octocat' },
  state: 'open',
  draft: false,
  updated_at: '2026-11-01T10:00:00Z',
  base: { ref: 'main', sha: 'base111' },
  head: { ref: 'feat/search', sha: 'head222' },
  html_url: 'https://github.com/acme/api/pull/1',
  merged_at: null,
};

const mergedPull = {
  ...openPull,
  number: 2,
  title: 'Old experiment',
  user: { login: 'Hubot' },
  state: 'closed',
  merged_at: '2026-10-01T10:00:00Z',
  html_url: 'https://github.com/acme/api/pull/2',
};

const pullRequest: PullRequest = {
  number: 1,
  title: 'Add search',
  author: 'Octocat',
  state: 'open',
  draft: false,
  updatedAt: '2026-11-01T10:00:00Z',
  baseRef: 'main',
  headRef: 'feat/search',
  headSha: 'head222',
  webUrl: 'https://github.com/acme/api/pull/1',
  commentCount: 5,
  body: '',
  baseSha: 'base111',
  mergeBaseSha: null,
};

// ── Contract ───────────────────────────────────────────────────────────────

const contractFetch = fakeFetch({
  [`GET ${API}/repos/acme/api/pulls?state=all&per_page=100`]: {
    json: [openPull],
    headers: { link: `<${API}/repos/acme/api/pulls?state=all&per_page=100&page=2>; rel="next"` },
  },
  [`GET ${API}/repos/acme/api/pulls?state=all&per_page=100&page=2`]: { json: [mergedPull] },
  [`GET ${API}/repos/acme/foreign/pulls?state=open&per_page=100`]: {
    json: [openPull],
    headers: { link: '<https://evil.test/pulls>; rel="next"' },
  },
  [`POST ${API}/repos/acme/fail/issues/3/comments`]: {
    status: 403,
    json: { message: 'Resource not accessible by integration' },
  },
});

const contractForge = createGitHubForge(
  host,
  createForgeHttp({
    apiUrl: API,
    auth: (headers) => headers.set('authorization', `Bearer ${TOKEN}`),
    fetchImpl: contractFetch,
  }),
);

describeForgeContract('github', {
  create: () => contractForge,
  repo,
  pullRequest: 7,
  network: {
    apiUrl: API,
    token: TOKEN,
    fetch: contractFetch,
    paginate: () => contractForge.listPullRequests(repo, { state: 'all' }),
    expectedItems: 2,
    foreignNext: () =>
      contractForge.listPullRequests({ host: 'github.com', project: 'acme/foreign' }, { state: 'open' }),
    failedSubmit: () =>
      contractForge.submit(
        { host: 'github.com', project: 'acme/fail' },
        3,
        pullRequest,
        [{ op: 'prComment', draftId: 'fail', body: 'Hello' }],
        null,
        null,
      ),
  },
});

// ── Reads ──────────────────────────────────────────────────────────────────

describe('GitHub reads', () => {
  it('caches the current user per strategy instance', async () => {
    const { forge, fake } = make({ [`GET ${API}/user`]: { json: { login: 'me' } } });

    expect(await forge.currentUser()).toBe('me');
    expect(await forge.currentUser()).toBe('me');
    expect(fake.calls).toHaveLength(1);
  });

  it('lists pull requests across pages, maps merged state and filters the author case-insensitively', async () => {
    const { forge } = make({
      [`GET ${API}/repos/acme/api/pulls?state=open&per_page=100`]: {
        json: [openPull],
        headers: {
          link: `<${API}/repos/acme/api/pulls?state=open&per_page=100&page=2>; rel="next"`,
        },
      },
      [`GET ${API}/repos/acme/api/pulls?state=open&per_page=100&page=2`]: { json: [mergedPull] },
    });

    const pulls = await forge.listPullRequests(repo, { state: 'open' });

    expect(pulls).toHaveLength(2);
    expect(pulls[0]).toMatchObject({
      number: 1,
      title: 'Add search',
      author: 'Octocat',
      state: 'open',
      draft: false,
      baseRef: 'main',
      headRef: 'feat/search',
      headSha: 'head222',
      webUrl: 'https://github.com/acme/api/pull/1',
      commentCount: null,
    });
    expect(pulls[1]).toMatchObject({ number: 2, state: 'merged' });

    const filtered = await forge.listPullRequests(repo, { state: 'open', author: 'oCTOcat' });
    expect(filtered.map((pull) => pull.number)).toEqual([1]);
  });

  it('reads one pull request with both commit shas, an empty body and the comment total', async () => {
    const { forge } = make({
      [`GET ${API}/repos/acme/api/pulls/7`]: {
        json: { ...openPull, number: 7, body: null, comments: 2, review_comments: 3 },
      },
    });

    const pull = await forge.getPullRequest(repo, 7);

    expect(pull).toMatchObject({
      number: 7,
      body: '',
      baseSha: 'base111',
      headSha: 'head222',
      mergeBaseSha: null,
      commentCount: 5,
    });
  });
});

// ── Threads ────────────────────────────────────────────────────────────────

const reviewComment = {
  id: 100,
  user: { login: 'me' },
  body: 'Root',
  path: 'src/a.ts',
  line: 12,
  start_line: null,
  side: 'RIGHT',
  original_line: 12,
  in_reply_to_id: null,
  created_at: '2026-11-01T10:00:00Z',
  updated_at: '2026-11-01T10:00:00Z',
  subject_type: 'line',
};

describe('GitHub threads', () => {
  it('groups review replies, maps outdated and file-level comments, and adds issue comments', async () => {
    const { forge } = make({
      [`GET ${API}/user`]: { json: { login: 'me' } },
      [`GET ${API}/repos/acme/api/pulls/1/comments?per_page=100`]: {
        json: [
          // The root is outdated: `line` is gone, `original_line` keeps its old position.
          { ...reviewComment, line: null, start_line: 11, original_line: 12 },
          {
            ...reviewComment,
            id: 101,
            user: { login: 'other' },
            body: 'Reply one',
            in_reply_to_id: 100,
            created_at: '2026-11-01T10:01:00Z',
          },
          {
            ...reviewComment,
            id: 102,
            body: 'Reply two',
            in_reply_to_id: 100,
            created_at: '2026-11-01T10:02:00Z',
          },
          {
            ...reviewComment,
            id: 200,
            user: { login: 'other' },
            body: 'Screenshot',
            path: 'docs/diagram.png',
            line: null,
            start_line: null,
            side: 'LEFT',
            original_line: null,
            subject_type: 'file',
          },
        ],
      },
      [`GET ${API}/repos/acme/api/issues/1/comments?per_page=100`]: {
        json: [
          {
            id: 300,
            user: { login: 'me' },
            body: 'Conversation one',
            created_at: '2026-11-01T11:00:00Z',
            updated_at: '2026-11-01T11:00:00Z',
          },
          {
            id: 301,
            user: { login: 'other' },
            body: 'Conversation two',
            created_at: '2026-11-01T11:01:00Z',
            updated_at: '2026-11-01T11:01:00Z',
          },
        ],
      },
    });

    const threads = await forge.listThreads(repo, 1);

    expect(threads).toHaveLength(4);

    const inline = threads.find((thread) => thread.id === '100');
    expect(inline).toMatchObject({
      path: 'src/a.ts',
      side: 'new',
      line: 12,
      startLine: 11,
      outdated: true,
      resolved: false,
    });
    expect(inline?.comments.map((comment) => comment.id)).toEqual(['100', '101', '102']);
    expect(inline?.comments.map((comment) => comment.canEdit)).toEqual([true, false, true]);

    const file = threads.find((thread) => thread.id === '200');
    expect(file).toMatchObject({
      path: 'docs/diagram.png',
      side: 'old',
      line: null,
      startLine: null,
      outdated: false,
      resolved: false,
    });
    expect(file?.comments[0]?.canEdit).toBe(false);

    const conversation = threads.filter((thread) => thread.path === null);
    expect(conversation.map((thread) => thread.id)).toEqual(['300', '301']);
    expect(conversation[0]?.comments[0]?.canEdit).toBe(true);
    expect(conversation[1]?.comments[0]?.canEdit).toBe(false);
    expect(conversation.every((thread) => thread.line === null && !thread.outdated)).toBe(true);
  });
});

// ── Submit ─────────────────────────────────────────────────────────────────

const threadRoute = {
  json: [
    { ...reviewComment, id: 500 },
    { ...reviewComment, id: 501, in_reply_to_id: 500 },
    { ...reviewComment, id: 502, in_reply_to_id: 501 },
  ],
};

describe('GitHub submit', () => {
  it('sends one approval review, then replies to the root, a PR comment, an edit and a delete', async () => {
    const { forge, fake } = make({
      [`POST ${API}/repos/acme/api/pulls/1/reviews`]: { json: { id: 900 } },
      [`GET ${API}/repos/acme/api/pulls/1/comments?per_page=100`]: threadRoute,
      [`POST ${API}/repos/acme/api/pulls/1/comments/500/replies`]: { json: { id: 700 } },
      [`POST ${API}/repos/acme/api/issues/1/comments`]: { json: { id: 800 } },
      [`PATCH ${API}/repos/acme/api/pulls/comments/600`]: { json: { id: 600 } },
      [`DELETE ${API}/repos/acme/api/pulls/comments/601`]: { status: 204 },
    });

    const drafts: DraftOperation[] = [
      { op: 'comment', draftId: 'c1', path: 'src/a.ts', side: 'new', line: 10, startLine: 8, body: 'Range' },
      { op: 'comment', draftId: 'c2', path: 'src/a.ts', side: 'old', line: 4, startLine: null, body: 'Single' },
      { op: 'reply', draftId: 'r1', threadId: '502', body: 'Answer' },
      { op: 'prComment', draftId: 'p1', body: 'Looks good' },
      { op: 'edit', draftId: 'e1', commentId: '600', body: 'Edited' },
      { op: 'delete', draftId: 'd1', commentId: '601' },
    ];

    const results = await forge.submit(repo, 1, pullRequest, drafts, 'approve', 'LGTM');

    const reviewCalls = fake.calls.filter(
      (call) => call.method === 'POST' && call.url === `${API}/repos/acme/api/pulls/1/reviews`,
    );
    expect(reviewCalls).toHaveLength(1);
    const reviewBody = JSON.parse(reviewCalls[0]?.body ?? '{}') as {
      body?: string;
      commit_id: string;
      event: string;
      comments: Array<Record<string, unknown>>;
    };
    expect(reviewBody.event).toBe('APPROVE');
    expect(reviewBody.commit_id).toBe('head222');
    expect(reviewBody.body).toBe('LGTM');
    expect(reviewBody.comments).toEqual([
      { path: 'src/a.ts', body: 'Range', line: 10, side: 'RIGHT', start_line: 8, start_side: 'RIGHT' },
      { path: 'src/a.ts', body: 'Single', line: 4, side: 'LEFT' },
    ]);

    expect(
      fake.calls.some(
        (call) =>
          call.method === 'POST' && call.url === `${API}/repos/acme/api/pulls/1/comments/500/replies`,
      ),
    ).toBe(true);
    expect(fake.calls.some((call) => call.method === 'PATCH')).toBe(true);
    expect(fake.calls.some((call) => call.method === 'DELETE')).toBe(true);

    expect(results.map((result) => [result.draftId, result.ok, result.remoteId])).toEqual([
      ['c1', true, '900'],
      ['c2', true, '900'],
      ['r1', true, '700'],
      ['p1', true, '800'],
      ['e1', true, '600'],
      ['d1', true, '601'],
    ]);
    expect(fake.calls.every((call) => new URL(call.url).origin === API)).toBe(true);
  });

  it('retries a rejected review per comment and downgrades only the outside-diff line', async () => {
    const { forge, fake } = make({
      [`POST ${API}/repos/acme/api/pulls/1/reviews`]: (call) => {
        const body = JSON.parse(call.body ?? '{}') as { comments?: Array<{ path: string }> };
        const comments = body.comments ?? [];
        const outside = comments.length === 1 && comments[0]?.path === 'src/b.ts';
        if (outside || comments.length > 1) {
          return {
            status: 422,
            // Real GitHub keeps the useful line detail in `errors[]`; only `message` reaches us.
            json: {
              message: 'Validation Failed',
              errors: [{ message: 'Pull request review comment is not part of the diff' }],
            },
          };
        }
        return { json: { id: 910 } };
      },
      [`POST ${API}/repos/acme/api/pulls/1/comments`]: { json: { id: 950 } },
    });

    const drafts: DraftOperation[] = [
      { op: 'comment', draftId: 'in', path: 'src/a.ts', side: 'new', line: 10, startLine: null, body: 'In diff' },
      { op: 'comment', draftId: 'out', path: 'src/b.ts', side: 'new', line: 4, startLine: null, body: 'Out of diff' },
    ];

    const results = await forge.submit(repo, 1, pullRequest, drafts, null, null);

    expect(results.map((result) => [result.draftId, result.ok, result.remoteId])).toEqual([
      ['in', true, '910'],
      ['out', true, '950'],
    ]);

    const fileCall = fake.calls.find(
      (call) => call.method === 'POST' && call.url === `${API}/repos/acme/api/pulls/1/comments`,
    );
    const fileBody = JSON.parse(fileCall?.body ?? '{}') as Record<string, unknown>;
    expect(fileBody).toEqual({
      commit_id: 'head222',
      path: 'src/b.ts',
      body: 'Line 4: Out of diff',
      subject_type: 'file',
    });
    expect(fileBody.line).toBeUndefined();
    expect(fake.calls.every((call) => new URL(call.url).origin === API)).toBe(true);
  });

  it('reports an edit 403 and still sends the other drafts', async () => {
    const { forge, fake } = make({
      [`PATCH ${API}/repos/acme/api/pulls/comments/600`]: {
        status: 403,
        json: { message: 'Resource not accessible by integration' },
      },
      [`POST ${API}/repos/acme/api/issues/1/comments`]: { json: { id: 800 } },
    });

    const drafts: DraftOperation[] = [
      { op: 'edit', draftId: 'e1', commentId: '600', body: 'Edited' },
      { op: 'prComment', draftId: 'p1', body: 'Still sent' },
    ];

    const results = await forge.submit(repo, 1, pullRequest, drafts, null, null);

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ draftId: 'e1', ok: false });
    expect(results[0]?.error).toContain('Resource not accessible');
    expect(results[1]).toMatchObject({ draftId: 'p1', ok: true, remoteId: '800' });
    expect(fake.calls.filter((call) => call.method === 'PATCH')).toHaveLength(1);
  });

  it('falls back to a conversation comment when the review-comment id is not found', async () => {
    const { forge, fake } = make({
      [`PATCH ${API}/repos/acme/api/pulls/comments/600`]: { status: 404, json: { message: 'Not Found' } },
      [`PATCH ${API}/repos/acme/api/issues/comments/600`]: { json: { id: 600 } },
      [`DELETE ${API}/repos/acme/api/pulls/comments/601`]: { status: 404, json: { message: 'Not Found' } },
      [`DELETE ${API}/repos/acme/api/issues/comments/601`]: { status: 204 },
    });

    const results = await forge.submit(
      repo,
      1,
      pullRequest,
      [
        { op: 'edit', draftId: 'e1', commentId: '600', body: 'Edited' },
        { op: 'delete', draftId: 'd1', commentId: '601' },
      ],
      null,
      null,
    );

    expect(results).toEqual([
      { draftId: 'e1', ok: true, remoteId: '600' },
      { draftId: 'd1', ok: true, remoteId: '601' },
    ]);
    expect(fake.calls.filter((call) => call.url.includes('/issues/comments/'))).toHaveLength(2);
  });

  it('reports a rejected token on every remaining draft without further requests', async () => {
    const { forge, fake } = make({
      [`POST ${API}/repos/acme/api/pulls/1/reviews`]: {
        status: 401,
        json: { message: 'Bad credentials' },
      },
    });

    const drafts: DraftOperation[] = [
      { op: 'comment', draftId: 'c1', path: 'src/a.ts', side: 'new', line: 10, startLine: null, body: 'Hi' },
      { op: 'prComment', draftId: 'p1', body: 'Never sent' },
    ];

    const results = await forge.submit(repo, 1, pullRequest, drafts, null, null);

    expect(results).toEqual([
      { draftId: 'c1', ok: false, error: 'Bad credentials' },
      { draftId: 'p1', ok: false, error: 'Bad credentials' },
    ]);
    expect(fake.calls).toHaveLength(1);
  });
});
