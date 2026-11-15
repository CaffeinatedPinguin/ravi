import type { IncomingMessage, ServerResponse } from 'node:http';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { Router } from './router.ts';
import { handleRequest } from './server.ts';
import type { SecurityOptions } from './security.ts';
import { SECURITY_HEADERS, decodeUiAssets } from './static.ts';

const security: SecurityOptions = {
  token: 'test-token',
  allowedHosts: ['127.0.0.1:4783'],
  skipSession: true,
};

const assets = decodeUiAssets({
  '/index.html': {
    type: 'text/html; charset=utf-8',
    gzipBase64: gzipSync(Buffer.from('<!doctype html><html><body>ravi</body></html>')).toString('base64'),
  },
  '/assets/app.js': {
    type: 'text/javascript; charset=utf-8',
    gzipBase64: gzipSync(Buffer.from('console.log(1)')).toString('base64'),
  },
});

type Captured = { status: number; headers: Record<string, string>; body: Buffer };

function request(url: string, method = 'GET'): IncomingMessage {
  return {
    url,
    method,
    headers: { host: '127.0.0.1:4783', 'accept-encoding': 'gzip' },
  } as unknown as IncomingMessage;
}

function captureResponse(): { res: ServerResponse; result: () => Captured } {
  let status = 0;
  let headers: Record<string, string> = {};
  let body: Buffer = Buffer.alloc(0);
  const res = {
    headersSent: false,
    writeHead(nextStatus: number, nextHeaders?: Record<string, string | number | string[]>) {
      status = nextStatus;
      headers = normalize(nextHeaders);
    },
    end(chunk?: Buffer | string) {
      if (chunk !== undefined) {
        body = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      }
    },
  } as unknown as ServerResponse;
  return { res, result: () => ({ status, headers, body }) };
}

function normalize(headers: Record<string, string | number | string[]> | undefined): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    normalized[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value);
  }
  return normalized;
}

function expectSecurityHeaders(headers: Record<string, string>): void {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    expect(headers[name]).toBe(value);
  }
}

describe('security headers', () => {
  it('puts them on the UI shell and its static assets', async () => {
    const router = new Router();
    for (const url of ['/', '/assets/app.js']) {
      const { res, result } = captureResponse();
      await handleRequest(request(url), res, { router, security, assets });
      const response = result();
      expect(response.status).toBe(200);
      expectSecurityHeaders(response.headers);
    }
  });

  it('puts them on the session handshake redirect', async () => {
    const { res, result } = captureResponse();
    await handleRequest(request('/?token=test-token'), res, {
      router: new Router(),
      security: { ...security, skipSession: false },
      assets,
    });
    const response = result();
    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/');
    expectSecurityHeaders(response.headers);
  });

  it('puts them on JSON API answers and API errors', async () => {
    const router = new Router();
    router.get('/api/health', () => ({ app: 'ravi', version: 'test' }));

    const success = captureResponse();
    await handleRequest(request('/api/health'), success.res, { router, security, assets });
    expect(success.result().status).toBe(200);
    expectSecurityHeaders(success.result().headers);

    const missing = captureResponse();
    await handleRequest(request('/api/missing'), missing.res, { router, security, assets });
    expect(missing.result().status).toBe(404);
    expectSecurityHeaders(missing.result().headers);
  });
});
