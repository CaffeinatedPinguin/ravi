/** Wires the router, the security checks and the embedded UI into one `node:http` request listener. */
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { HttpError, raw, readJsonBody } from './router.ts';
import type { RawResponse, Router } from './router.ts';
import { assertAllowedHost, assertApiAccess, sessionCookie, tokensMatch } from './security.ts';
import type { SecurityOptions } from './security.ts';
import { serveUiAsset } from './static.ts';
import type { UiAssets } from './static.ts';

export type ServerOptions = {
  router: Router;
  security: SecurityOptions;
  /** `null` in development, where Vite serves the UI. */
  assets: UiAssets | null;
};

export function createHttpServer(options: ServerOptions): Server {
  return createServer((req, res) => {
    respond(req, res, options).catch((error: unknown) => {
      sendError(res, error);
    });
  });
}

async function respond(req: IncomingMessage, res: ServerResponse, options: ServerOptions): Promise<void> {
  assertAllowedHost(req, options.security);
  const url = new URL(req.url ?? '/', 'http://localhost');
  const method = req.method ?? 'GET';

  if (url.pathname.startsWith('/api/')) {
    assertApiAccess(req, options.security);
    const match = options.router.match(method, url.pathname);
    if (!match) {
      throw new HttpError(404, `No route for ${method} ${url.pathname}`);
    }
    const result = await match.handler({
      req,
      params: match.params,
      query: url.searchParams,
      body: (schema) => readJsonBody(req, schema),
    });
    send(res, result);
    return;
  }

  if (method !== 'GET' && method !== 'HEAD') {
    throw new HttpError(405, 'Method not allowed');
  }
  const handshake = sessionHandshake(url, options.security.token);
  if (handshake) {
    send(res, handshake);
    return;
  }
  const asset = options.assets ? serveUiAsset(options.assets, req, url.pathname) : null;
  if (!asset) {
    throw new HttpError(404, 'Not found');
  }
  send(res, asset);
}

/**
 * The CLI opens `/?token=…`. A valid token becomes an HttpOnly cookie and is stripped from the
 * address bar by a redirect, so it never ends up in history or a copied link.
 */
function sessionHandshake(url: URL, token: string): RawResponse | null {
  const candidate = url.searchParams.get('token');
  if (candidate === null) {
    return null;
  }
  if (!tokensMatch(candidate, token)) {
    throw new HttpError(401, 'Invalid session token');
  }
  url.searchParams.delete('token');
  return raw(302, { location: `${url.pathname}${url.search}`, 'set-cookie': sessionCookie(token) });
}

function send(res: ServerResponse, result: unknown): void {
  if (isRawResponse(result)) {
    res.writeHead(result.status, result.headers);
    res.end(result.body);
    return;
  }
  if (result === undefined) {
    res.writeHead(204);
    res.end();
    return;
  }
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(result));
}

function sendError(res: ServerResponse, error: unknown): void {
  const status = error instanceof HttpError ? error.status : 500;
  const message = error instanceof Error ? error.message : 'Unexpected error';
  if (status === 500) {
    console.error(error);
  }
  if (res.headersSent) {
    res.end();
    return;
  }
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify({ error: message }));
}

function isRawResponse(value: unknown): value is RawResponse {
  return typeof value === 'object' && value !== null && 'raw' in value && value.raw === true;
}
