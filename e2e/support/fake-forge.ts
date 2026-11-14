/**
 * A tiny in-memory GitHub REST API for the E2E suite. Only the endpoints the GitHub strategy calls
 * are implemented; every write is recorded so a test can assert that nothing was sent by accident.
 */
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export type RecordedRequest = { method: string; path: string; body: string };
export type FakeForge = { url: string; writes: RecordedRequest[]; stop: () => Promise<void> };

const PROJECT = '/repos/e2e/sample';
const PULLS = `${PROJECT}/pulls`;
const PULL = `${PULLS}/1`;
const ISSUE_COMMENTS = `${PROJECT}/issues/1/comments`;
const CREATED_AT = '2026-11-14T10:00:00Z';

export function startFakeForge(): Promise<FakeForge> {
  const writes: RecordedRequest[] = [];
  let nextId = 1000;
  const pull = {
    number: 1, title: 'E2E pull request', user: { login: 'e2e-user' }, state: 'open', draft: false,
    updated_at: CREATED_AT, base: { ref: 'main', sha: 'base-sha' }, head: { ref: 'feature', sha: 'head-sha' },
    html_url: 'https://github.com/e2e/sample/pull/1', merged_at: null,
    body: 'A pull request served by the fake forge.', comments: 0, review_comments: 1,
  };
  // One existing review thread so the pull request screens have something to render.
  const comment = {
    id: 500, user: { login: 'alice' }, body: 'Please rename this helper.', path: 'src/util.ts', line: 2,
    start_line: null, side: 'RIGHT', original_line: 2, in_reply_to_id: null,
    created_at: CREATED_AT, updated_at: CREATED_AT,
  };
  const replies = new RegExp(`^${PULL}/comments/\\d+/replies$`);
  const reads: Record<string, unknown> = {
    '/user': { login: 'e2e-user' },
    [PULLS]: [pull],
    [PULL]: pull,
    [`${PULL}/comments`]: [comment],
    [ISSUE_COMMENTS]: [],
  };
  const writePaths = new Set([`${PULL}/reviews`, `${PULL}/comments`, ISSUE_COMMENTS]);

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
    if (method === 'GET' && pathname in reads) {
      send(response, 200, reads[pathname]);
    } else if (method === 'POST' && (writePaths.has(pathname) || replies.test(pathname))) {
      send(response, 201, { id: nextId++ });
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
