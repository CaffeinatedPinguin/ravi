import { describe, expect, it } from 'vitest';
import type { DraftOperation, PullRequest, RepoRef } from '../../shared/forge.ts';
import { describeForgeContract } from './contract.ts';
import type { Forge, ForgeHost } from './forge.ts';
import { createGitLabForge } from './gitlab.ts';
import type { GitLabDraft, GitLabForgeOptions } from './gitlab.ts';
import type { FetchLike } from './http.ts';
import { createForgeHttp } from './http.ts';
import type { FakeCall, FakeResponse, FakeRoute } from './testing.ts';
import { fakeFetch } from './testing.ts';

const API = 'https://gitlab.com/api/v4';
const TOKEN = 'glpat-test-token';
const PROJECT = 'group/sub/proj';
const ENCODED = 'group%2Fsub%2Fproj';
const MR = 7;
const BASE = 'base123';
const START = 'start123';
const HEAD = 'head123';

const REPO: RepoRef = { host: 'gitlab.com', project: PROJECT };
const HOST: ForgeHost = {
  host: 'gitlab.com',
  kind: 'gitlab',
  apiUrl: API,
  webUrl: 'https://gitlab.com',
  tokenEnv: 'GITLAB_TOKEN',
  auth: () => undefined,
};

const MR_URL = `${API}/projects/${ENCODED}/merge_requests/${MR}`;
const DRAFT_NOTES_URL = `${MR_URL}/draft_notes`;
const DISCUSSIONS_URL = `${MR_URL}/discussions?per_page=100`;

const PR: PullRequest = {
  number: MR,
  title: 'Add feature',
  author: 'alice',
  state: 'open',
  draft: false,
  updatedAt: '2026-01-01T00:00:00Z',
  baseRef: 'main',
  headRef: 'feature',
  headSha: HEAD,
  webUrl: `https://gitlab.com/${PROJECT}/-/merge_requests/${MR}`,
  commentCount: 3,
  body: 'Body',
  baseSha: BASE,
  mergeBaseSha: BASE,
};

function auth(headers: Headers): void {
  headers.set('private-token', TOKEN);
}

function mergeRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iid: MR,
    title: 'Add feature',
    description: 'Body',
    author: { username: 'alice' },
    state: 'opened',
    draft: false,
    updated_at: '2026-01-01T00:00:00Z',
    source_branch: 'feature',
    target_branch: 'main',
    sha: HEAD,
    web_url: `https://gitlab.com/${PROJECT}/-/merge_requests/${MR}`,
    user_notes_count: 3,
    diff_refs: { base_sha: BASE, head_sha: HEAD, start_sha: START },
    ...overrides,
  };
}

function makeForge(routes: Record<string, FakeRoute>, overrides: Partial<GitLabForgeOptions> = {}): {
  forge: Forge;
  fake: ReturnType<typeof fakeFetch>;
} {
  const fake = fakeFetch(routes);
  const http = createForgeHttp({ apiUrl: API, auth, fetchImpl: fake });
  const options: GitLabForgeOptions = {
    auth,
    fetchImpl: fake,
    readAsset: () => Promise.resolve({ data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), type: 'image/png' }),
    ...overrides,
  };
  return { forge: createGitLabForge(HOST, http, options), fake };
}

function parseJson(text: string | null): unknown {
  if (text === null) {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

// ── Shared contract ─────────────────────────────────────────────────────────

function summary(iid: number): Record<string, unknown> {
  return {
    iid,
    title: `MR ${iid}`,
    author: { username: 'alice' },
    state: 'opened',
    draft: false,
    updated_at: '2026-01-01T00:00:00Z',
    source_branch: `feature-${iid}`,
    target_branch: 'main',
    sha: `sha${iid}`,
    web_url: `https://gitlab.com/${PROJECT}/-/merge_requests/${iid}`,
    user_notes_count: 1,
  };
}

const CONTRACT_PAGE_1 = `${API}/projects/${ENCODED}/merge_requests?state=all&per_page=100`;
const CONTRACT_PAGE_2 = `${CONTRACT_PAGE_1}&page=2`;
const CONTRACT_OPEN = `${API}/projects/${ENCODED}/merge_requests?state=opened&per_page=100`;

const contractFake = fakeFetch({
  [`GET ${CONTRACT_PAGE_1}`]: {
    json: [summary(1), summary(2)],
    headers: { link: `<${CONTRACT_PAGE_2}>; rel="next"` },
  },
  [`GET ${CONTRACT_PAGE_2}`]: { json: [summary(3)] },
  [`GET ${CONTRACT_OPEN}`]: {
    json: [summary(4)],
    headers: { link: '<https://evil.test/merge_requests?page=2>; rel="next"' },
  },
  [`POST ${DRAFT_NOTES_URL}`]: { status: 400, json: { message: 'note position is invalid' } },
});

const contractHttp = createForgeHttp({ apiUrl: API, auth, fetchImpl: contractFake });
const contractForge = (): Forge =>
  createGitLabForge(HOST, contractHttp, {
    auth,
    fetchImpl: contractFake,
    readAsset: () => Promise.resolve({ data: new Uint8Array(), type: 'image/png' }),
  });

const failedDraft: DraftOperation = { op: 'prComment', draftId: 'fail-1', body: 'Will be rejected' };

describeForgeContract('GitLab', {
  create: contractForge,
  repo: REPO,
  pullRequest: MR,
  network: {
    apiUrl: API,
    token: TOKEN,
    fetch: contractFake,
    paginate: () => contractForge().listPullRequests(REPO, { state: 'all' }),
    expectedItems: 3,
    foreignNext: () => contractForge().listPullRequests(REPO, { state: 'open' }),
    failedSubmit: () => contractForge().submit(REPO, MR, PR, [failedDraft], null, null),
  },
});

// ── Pull requests ───────────────────────────────────────────────────────────

describe('GitLab pull requests', () => {
  it('maps a merge request and its diff refs to the shared model', async () => {
    const { forge } = makeForge({
      [`GET ${MR_URL}`]: { json: mergeRequest({ state: 'merged', draft: true }) },
    });

    const pr = await forge.getPullRequest(REPO, MR);

    expect(pr).toMatchObject({
      number: MR,
      title: 'Add feature',
      author: 'alice',
      state: 'merged',
      draft: true,
      baseSha: BASE,
      headSha: HEAD,
      mergeBaseSha: BASE,
      commentCount: 3,
    });
  });
});

// ── listThreads ─────────────────────────────────────────────────────────────

function note(id: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    body: `Note ${id}`,
    author: { username: 'alice' },
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    system: false,
    resolvable: true,
    resolved: false,
    ...overrides,
  };
}

function position(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    base_sha: BASE,
    start_sha: START,
    head_sha: HEAD,
    old_path: 'src/a.ts',
    new_path: 'src/a.ts',
    position_type: 'text',
    old_line: null,
    new_line: null,
    ...overrides,
  };
}

// ── listThreads ─────────────────────────────────────────────────────────────

describe('GitLab listThreads', () => {
  it('maps discussions, skips system notes and marks outdated/resolved threads', async () => {
    const discussions = [
      {
        id: 'd1',
        individual_note: false,
        notes: [
          note(101, { position: position({ new_line: 5 }) }),
          note(102, { author: { username: 'bob' } }),
        ],
      },
      {
        id: 'd2',
        notes: [note(201, { position: position({ old_path: 'src/b.ts', new_path: 'src/b.ts', old_line: 3 }) })],
      },
      {
        id: 'd3',
        notes: [note(301, { position: position({ head_sha: 'oldhead', new_path: 'src/c.ts', new_line: 10 }) })],
      },
      {
        id: 'd4',
        notes: [
          note(401, { resolved: true, position: position({ new_path: 'src/d.ts', new_line: 2 }) }),
        ],
      },
      {
        id: 'd5',
        notes: [
          note(501, {
            position: position({
              new_path: 'src/e.ts',
              new_line: 9,
              line_range: { start: { type: 'new', new_line: 7 }, end: { type: 'new', new_line: 9 } },
            }),
          }),
        ],
      },
      { id: 'd6', notes: [note(601)] },
      { id: 'd7', notes: [note(701, { system: true, body: 'added 1 commit' })] },
    ];

    const { forge } = makeForge({
      [`GET ${MR_URL}`]: { json: mergeRequest() },
      [`GET ${API}/user`]: { json: { username: 'alice' } },
      [`GET ${DISCUSSIONS_URL}`]: { json: discussions },
    });

    const threads = await forge.listThreads(REPO, MR);

    expect(threads.map((thread) => thread.id)).toEqual(['d1', 'd2', 'd3', 'd4', 'd5', 'd6']);

    const added = threads.find((thread) => thread.id === 'd1');
    expect(added).toMatchObject({
      path: 'src/a.ts',
      side: 'new',
      line: 5,
      startLine: null,
      outdated: false,
      resolved: false,
    });
    expect(added?.comments.map((comment) => [comment.id, comment.author, comment.canEdit])).toEqual([
      ['101', 'alice', true],
      ['102', 'bob', false],
    ]);

    expect(threads.find((thread) => thread.id === 'd2')).toMatchObject({
      path: 'src/b.ts',
      side: 'old',
      line: 3,
      outdated: false,
    });
    expect(threads.find((thread) => thread.id === 'd3')).toMatchObject({ path: 'src/c.ts', outdated: true });
    expect(threads.find((thread) => thread.id === 'd4')).toMatchObject({ path: 'src/d.ts', resolved: true });
    expect(threads.find((thread) => thread.id === 'd5')).toMatchObject({ startLine: 7, line: 9 });
    expect(threads.find((thread) => thread.id === 'd6')).toMatchObject({
      path: null,
      side: 'new',
      line: null,
      startLine: null,
      outdated: false,
    });
    expect(threads.some((thread) => thread.comments.some((comment) => comment.body === 'added 1 commit'))).toBe(false);
  });
});

// ── submit ──────────────────────────────────────────────────────────────────

type DraftNoteBody = {
  note?: unknown;
  position?: Record<string, unknown>;
  in_reply_to_discussion_id?: unknown;
};

describe('GitLab submit', () => {
  it('uploads images once, creates draft notes with positions and publishes a requested-changes review', async () => {
    let nextNoteId = 100;
    const draftNoteBodies: DraftNoteBody[] = [];
    let publishBody: unknown = null;
    const uploads: FormData[] = [];

    const routes: Record<string, FakeRoute> = {
      [`GET ${MR_URL}`]: { json: mergeRequest() },
      [`POST ${API}/projects/${ENCODED}/uploads`]: {
        status: 201,
        json: { markdown: '![shot](https://gitlab.com/uploads/abc/shot.png)' },
      },
      [`POST ${DRAFT_NOTES_URL}`]: (call: FakeCall): FakeResponse => {
        draftNoteBodies.push(parseJson(call.body) as DraftNoteBody);
        const id = nextNoteId;
        nextNoteId += 1;
        return { status: 201, json: { id } };
      },
      [`POST ${DRAFT_NOTES_URL}/bulk_publish`]: (call: FakeCall): FakeResponse => {
        publishBody = parseJson(call.body);
        return { json: {} };
      },
    };

    const inner = fakeFetch(routes);
    const fetchImpl: FetchLike = (url, init) => {
      if (url.endsWith('/uploads') && init.body instanceof FormData) {
        uploads.push(init.body);
      }
      return inner(url, init);
    };
    const http = createForgeHttp({ apiUrl: API, auth, fetchImpl });
    const forge = createGitLabForge(HOST, http, {
      auth,
      fetchImpl,
      readAsset: () => Promise.resolve({ data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), type: 'image/png' }),
    });

    const drafts: GitLabDraft[] = [
      { op: 'comment', draftId: 'c1', path: 'src/a.ts', side: 'new', line: 5, startLine: null, body: 'Added note' },
      {
        op: 'comment',
        draftId: 'c2',
        path: 'src/a.ts',
        side: 'new',
        line: 9,
        startLine: null,
        body: 'Context note',
        lineKind: 'unchanged',
      },
      { op: 'comment', draftId: 'c3', path: 'src/a.ts', side: 'new', line: 12, startLine: 10, body: 'Range note' },
      {
        op: 'comment',
        draftId: 'c4',
        path: 'src/b.ts',
        side: 'old',
        line: 3,
        startLine: null,
        body: 'Removed note',
      },
      { op: 'reply', draftId: 'r1', threadId: 'discussion-1', body: 'Reply' },
      { op: 'prComment', draftId: 'p1', body: 'General' },
      {
        op: 'comment',
        draftId: 'i1',
        path: 'src/a.ts',
        side: 'new',
        line: 15,
        startLine: null,
        body: 'Shot: ![s](asset:shot.png)',
      },
    ];

    const results = await forge.submit(REPO, MR, PR, drafts, 'requestChanges', 'Overall summary');

    expect(uploads).toHaveLength(1);
    expect(draftNoteBodies).toHaveLength(drafts.length);

    const byNote = (text: string): DraftNoteBody | undefined =>
      draftNoteBodies.find((body) => body.note === text);

    const added = byNote('Added note');
    expect(added?.position).toMatchObject({
      position_type: 'text',
      base_sha: BASE,
      start_sha: START,
      head_sha: HEAD,
      old_path: 'src/a.ts',
      new_path: 'src/a.ts',
      new_line: 5,
    });
    expect(added?.position).not.toHaveProperty('old_line');

    expect(byNote('Context note')?.position).toMatchObject({ old_line: 9, new_line: 9 });

    expect(byNote('Range note')?.position).toMatchObject({
      new_line: 12,
      line_range: { start: { type: 'new', new_line: 10 }, end: { type: 'new', new_line: 12 } },
    });

    expect(byNote('Removed note')?.position).toMatchObject({ old_line: 3 });
    expect(byNote('Removed note')?.position).not.toHaveProperty('new_line');

    expect(byNote('Reply')?.in_reply_to_discussion_id).toBe('discussion-1');
    expect(byNote('Reply')?.position).toBeUndefined();
    expect(byNote('General')?.position).toBeUndefined();
    expect(byNote('Shot: ![shot](https://gitlab.com/uploads/abc/shot.png)')?.position).toMatchObject({
      new_line: 15,
    });

    expect(publishBody).toEqual({ note: 'Overall summary', reviewer_state: 'requested_changes' });
    expect(results).toHaveLength(drafts.length);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(results.map((result) => result.remoteId)).toEqual(['100', '101', '102', '103', '104', '105', '106']);

    const origin = new URL(API).origin;
    expect(inner.calls.every((call) => new URL(call.url).origin === origin)).toBe(true);
  });

  it('fails the draft results and deletes created drafts when bulk_publish fails', async () => {
    const routes: Record<string, FakeRoute> = {
      [`GET ${MR_URL}`]: { json: mergeRequest() },
      [`POST ${DRAFT_NOTES_URL}`]: { status: 201, json: { id: 55 } },
      [`POST ${DRAFT_NOTES_URL}/bulk_publish`]: { status: 500, json: { message: 'publish exploded' } },
      [`DELETE ${DRAFT_NOTES_URL}/55`]: { status: 204 },
    };
    const { forge, fake } = makeForge(routes);
    const drafts: DraftOperation[] = [
      { op: 'comment', draftId: 'c1', path: 'src/a.ts', side: 'new', line: 1, startLine: null, body: 'Note' },
    ];

    const results = await forge.submit(REPO, MR, PR, drafts, 'requestChanges', null);

    expect(results).toHaveLength(1);
    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.error).toContain('publish exploded');
    expect(fake.calls.some((call) => call.method === 'DELETE' && call.url.endsWith('/draft_notes/55'))).toBe(true);
  });

  it('approves with the pull request head SHA after publishing', async () => {
    const routes: Record<string, FakeRoute> = {
      [`POST ${DRAFT_NOTES_URL}`]: { status: 201, json: { id: 77 } },
      [`POST ${DRAFT_NOTES_URL}/bulk_publish`]: { json: {} },
      [`POST ${MR_URL}/approve`]: { json: {} },
    };
    const { forge, fake } = makeForge(routes);
    const drafts: DraftOperation[] = [{ op: 'prComment', draftId: 'p1', body: 'General' }];

    const results = await forge.submit(REPO, MR, PR, drafts, 'approve', null);

    expect(results).toHaveLength(1);
    expect(results[0]?.ok).toBe(true);

    const publishIndex = fake.calls.findIndex((call) => call.url.endsWith('/bulk_publish'));
    const approveIndex = fake.calls.findIndex((call) => call.url.endsWith('/approve'));
    expect(publishIndex).toBeGreaterThanOrEqual(0);
    expect(approveIndex).toBeGreaterThan(publishIndex);
    expect(fake.calls[approveIndex]?.body).toBe(JSON.stringify({ sha: HEAD }));
  });

  it('stops after a 401 and reports it on the remaining drafts', async () => {
    const routes: Record<string, FakeRoute> = {
      [`POST ${DRAFT_NOTES_URL}`]: { status: 401, json: { message: '401 Unauthorized' } },
    };
    const { forge, fake } = makeForge(routes);
    const drafts: DraftOperation[] = [
      { op: 'prComment', draftId: 'p1', body: 'First' },
      { op: 'prComment', draftId: 'p2', body: 'Second' },
    ];

    const results = await forge.submit(REPO, MR, PR, drafts, null, null);

    expect(results).toHaveLength(2);
    expect(results.every((result) => !result.ok)).toBe(true);
    expect(fake.calls.filter((call) => call.url === DRAFT_NOTES_URL)).toHaveLength(1);
  });

  it('looks up the discussion once for edits and deletes', async () => {
    const discussions = [
      {
        id: 'discussion-9',
        notes: [note(101), note(102)],
      },
    ];
    const routes: Record<string, FakeRoute> = {
      [`GET ${MR_URL}`]: { json: mergeRequest() },
      [`GET ${API}/user`]: { json: { username: 'alice' } },
      [`GET ${DISCUSSIONS_URL}`]: { json: discussions },
      [`PUT ${MR_URL}/discussions/discussion-9/notes/101`]: { json: { id: 101 } },
      [`DELETE ${MR_URL}/discussions/discussion-9/notes/102`]: { status: 204 },
    };
    const { forge, fake } = makeForge(routes);
    const drafts: DraftOperation[] = [
      { op: 'edit', draftId: 'e1', commentId: '101', body: 'Edited' },
      { op: 'delete', draftId: 'd1', commentId: '102' },
    ];

    const results = await forge.submit(REPO, MR, PR, drafts, null, null);

    expect(results).toEqual([
      { draftId: 'e1', ok: true, remoteId: '101' },
      { draftId: 'd1', ok: true, remoteId: '102' },
    ]);
    expect(fake.calls.filter((call) => call.url === DISCUSSIONS_URL)).toHaveLength(1);
    const edit = fake.calls.find((call) => call.method === 'PUT');
    expect(parseJson(edit?.body ?? null)).toEqual({ body: 'Edited' });
  });
});
