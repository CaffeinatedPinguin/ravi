/**
 * Extended GitHub REST fake for the flow specs.
 *
 * The original `fake-forge.ts` answers with fixed sha values, which is enough for a dashboard but
 * not for opening a pull request: `open` runs `git fetch`, resolves the base commit and computes a
 * merge base. This server takes the real commit ids of the fixture and keeps its comment list
 * mutable, so a test can simulate the forge receiving two new comments between notification polls.
 *
 * Everything stays on the loopback interface: `startApp` points the GitHub strategy here through
 * `RAVI_E2E_FORGE`, and no real forge is ever contacted.
 */
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export type RecordedRequest = { method: string; path: string; body: string };

export type FakePullRequest = {
  /** Login of the author; the dashboard groups the pull by this value. */
  author: string;
  title?: string;
  baseSha: string;
  headSha: string;
  baseRef?: string;
  headRef?: string;
  /** Whether the token user is in `requested_reviewers`. */
  requested?: boolean;
  body?: string;
};

export type FakeReviewComment = {
  id: number;
  author: string;
  body: string;
  path: string;
  line: number;
  side: 'RIGHT' | 'LEFT';
  createdAt: string;
};

export type NewReviewComment = Omit<FakeReviewComment, 'id' | 'side' | 'createdAt'> & {
  id?: number;
  side?: 'RIGHT' | 'LEFT';
  createdAt?: string;
};

export type ExtendedFakeForge = {
  url: string;
  writes: RecordedRequest[];
  /** Simulates a comment arriving on the forge while the app is open. */
  addComment: (comment: NewReviewComment) => FakeReviewComment;
  stop: () => Promise<void>;
};

const PROJECT = '/repos/e2e/sample';
const PULLS = `${PROJECT}/pulls`;
const PULL = `${PULLS}/1`;
const ISSUE_COMMENTS = `${PROJECT}/issues/1/comments`;
const REVIEWS = `${PULL}/reviews`;
const CREATED_AT = '2026-11-14T10:00:00Z';
const BOT_LOGIN = 'e2e-user';

export function startExtraFakeForge(options: {
  pull: FakePullRequest;
  comments?: readonly FakeReviewComment[];
}): Promise<ExtendedFakeForge> {
  const pull = options.pull;
  const comments: FakeReviewComment[] = [...(options.comments ?? [])];
  const writes: RecordedRequest[] = [];
  let nextReviewId = 1000;
  let nextCommentId = 5000;

  const addComment = (comment: NewReviewComment): FakeReviewComment => {
    const created: FakeReviewComment = {
      id: comment.id ?? nextCommentId++,
      author: comment.author,
      body: comment.body,
      path: comment.path,
      line: comment.line,
      side: comment.side ?? 'RIGHT',
      createdAt: comment.createdAt ?? new Date().toISOString(),
    };
    comments.push(created);
    return created;
  };

  const listPull = (): Record<string, unknown> => ({
    number: 1,
    title: pull.title ?? 'E2E pull request',
    user: { login: pull.author },
    state: 'open',
    draft: false,
    updated_at: CREATED_AT,
    base: { ref: pull.baseRef ?? 'main', sha: pull.baseSha },
    head: { ref: pull.headRef ?? 'feature', sha: pull.headSha },
    html_url: `${PROJECT.replace('/repos', 'https://github.com')}/pull/1`,
    merged_at: null,
    body: pull.body ?? 'A pull request served by the fake forge.',
    comments: 0,
    review_comments: comments.length,
    requested_reviewers: pull.requested === true ? [{ login: BOT_LOGIN }] : [],
  });

  const detailPull = (): Record<string, unknown> => ({ ...listPull(), body: pull.body ?? 'A pull request served by the fake forge.' });

  const commentPayload = (comment: FakeReviewComment): Record<string, unknown> => ({
    id: comment.id,
    user: { login: comment.author },
    body: comment.body,
    path: comment.path,
    line: comment.line,
    start_line: null,
    side: comment.side,
    original_line: comment.line,
    in_reply_to_id: null,
    created_at: comment.createdAt,
    updated_at: comment.createdAt,
  });

  const server = createServer((request, response) => {
    void handle(request, response);
  });

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const method = request.method ?? 'GET';
    const { pathname } = new URL(request.url ?? '/', 'http://127.0.0.1');
    const body = await readBody(request);
    if (method !== 'GET' && method !== 'HEAD') {
      writes.push({ method, path: pathname, body });
    }

    if (method === 'GET' && pathname === '/user') {
      send(response, 200, { login: BOT_LOGIN });
    } else if (method === 'GET' && pathname === PULLS) {
      send(response, 200, [listPull()]);
    } else if (method === 'GET' && pathname === PULL) {
      send(response, 200, detailPull());
    } else if (method === 'GET' && pathname === `${PULL}/comments`) {
      send(response, 200, comments.map(commentPayload));
    } else if (method === 'GET' && pathname === ISSUE_COMMENTS) {
      send(response, 200, []);
    } else if (method === 'POST' && pathname === REVIEWS) {
      send(response, 201, { id: nextReviewId++ });
    } else {
      send(response, 404, { message: 'Not Found' });
    }
  }

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        writes,
        addComment,
        stop: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      body += chunk;
    });
    request.on('end', () => resolve(body));
  });
}

function send(response: ServerResponse, status: number, value: unknown): void {
  const payload = JSON.stringify(value);
  response.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) });
  response.end(payload);
}
