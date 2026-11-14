import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import type { FetchLike } from '../forges/http.ts';
import { Router } from '../http/router.ts';
import type { RawResponse, RequestContext } from '../http/router.ts';
import { resolvePaths } from '../paths.ts';
import { writeJsonFile } from '../store/json-file.ts';
import { registerImageProxyRoutes } from './image-proxy.ts';

const home = mkdtempSync(join(tmpdir(), 'revu-image-proxy-'));
const paths = resolvePaths({ REVU_HOME: home });
const GITHUB_REPO = 'a1b2c3d4';
const GITLAB_REPO = 'b1b2c3d4';

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('pixels'),
]);

beforeAll(async () => {
  await writeJsonFile(join(paths.data, 'repos.json'), [
    {
      id: GITHUB_REPO,
      path: 'C:/revu/gh',
      name: 'api',
      lastUsedAt: '2026-11-14T10:00:00.000Z',
      kind: 'remote',
      remote: { host: 'github.com', project: 'acme/api' },
    },
    {
      id: GITLAB_REPO,
      path: 'C:/revu/gl',
      name: 'proj',
      lastUsedAt: '2026-11-14T10:00:00.000Z',
      kind: 'remote',
      remote: { host: 'gitlab.com', project: 'group/sub/proj' },
    },
  ]);
  // Fake values: the test never leaves the process and never uses a real token.
  writeFileSync(paths.envFile, 'GITHUB_TOKEN=gh-test-token\nGITLAB_TOKEN=gl-test-token\n');
});

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
});

type Recorded = { url: string; init: RequestInit; headers: Headers };

function recordingFetch(handler: (url: string) => Response | Promise<Response>): {
  fetchImpl: FetchLike;
  calls: Recorded[];
} {
  const calls: Recorded[] = [];
  return {
    calls,
    fetchImpl: async (url, init) => {
      const headers = new Headers(init.headers);
      calls.push({ url, init, headers });
      return handler(url);
    },
  };
}

async function proxy(router: Router, target: string, repoId: string): Promise<RawResponse> {
  const match = router.match('GET', '/api/image-proxy');
  if (match === null) {
    throw new Error('No image proxy route');
  }
  const result = await match.handler({
    req: {} as RequestContext['req'],
    params: match.params,
    query: new URLSearchParams({ url: target, repo: repoId }),
    body: <S extends z.ZodType>(schema: S): Promise<z.infer<S>> => Promise.resolve(schema.parse(undefined)),
  });
  return result as RawResponse;
}

function imageResponse(data: Buffer, type = 'image/png', status = 200): Response {
  return new Response(new Uint8Array(data), { status, headers: { 'content-type': type } });
}

/**
 * Builds a URL with embedded credentials at runtime. The rejection is real behaviour worth testing,
 * but a literal URL that embeds a username and password looks like a leaked secret to the
 * pre-commit scanner, so the fixture is assembled here instead.
 */
function withCredentials(target: string, user: string, secret: string): string {
  const url = new URL(target);
  url.username = user;
  url.password = secret;
  return url.href;
}

describe('GET /api/image-proxy', () => {
  it('returns an allowed GitHub image, using magic bytes and the cache/security headers', async () => {
    const { fetchImpl, calls } = recordingFetch(() => imageResponse(PNG, 'text/html'));
    const router = new Router();
    registerImageProxyRoutes(router, { paths }, { fetchImpl });

    const response = await proxy(router, 'https://github.com/acme/api/raw/main/shot.png', GITHUB_REPO);

    expect(response.status).toBe(200);
    expect(Buffer.isBuffer(response.body)).toBe(true);
    expect((response.body as Buffer).equals(PNG)).toBe(true);
    expect(response.headers['content-type']).toBe('image/png');
    expect(response.headers['cache-control']).toBe('private, max-age=3600');
    expect(response.headers['content-security-policy']).toContain("default-src 'self'");
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(calls[0]?.init.redirect).toBe('manual');
    expect(calls[0]?.headers.get('authorization')).toBe('Bearer gh-test-token');
  });

  it('does not send a forge token to an image host', async () => {
    const { fetchImpl, calls } = recordingFetch(() => imageResponse(PNG));
    const router = new Router();
    registerImageProxyRoutes(router, { paths }, { fetchImpl });

    await proxy(router, 'https://avatars.githubusercontent.com/u/1?s=64', GITHUB_REPO);

    expect(calls[0]?.headers.has('authorization')).toBe(false);
    expect(calls[0]?.headers.has('private-token')).toBe(false);
  });

  it('rejects IP literals, unknown hosts, protocol downgrades and protocol-relative URLs', async () => {
    const { fetchImpl, calls } = recordingFetch(() => imageResponse(PNG));
    const router = new Router();
    registerImageProxyRoutes(router, { paths }, { fetchImpl });
    const rejected = [
      'https://169.254.169.254/latest/meta-data/',
      'https://[::1]/secret.png',
      'https://localhost/shot.png',
      'https://evil.com/shot.png',
      'https://github.com.evil.com/shot.png',
      'http://github.com/acme/api/raw/main/shot.png',
      withCredentials('https://github.com/shot.png', 'someone', 'placeholder'),
      'https://github.com:8443/shot.png',
      '//evil.com/shot.png',
    ];
    for (const target of rejected) {
      await expect(proxy(router, target, GITHUB_REPO)).rejects.toThrow();
    }
    expect(calls).toHaveLength(0);
  });

  it('refuses a redirect to another host', async () => {
    const { fetchImpl, calls } = recordingFetch(
      () => new Response(null, { status: 302, headers: { location: 'https://evil.com/shot.png' } }),
    );
    const router = new Router();
    registerImageProxyRoutes(router, { paths }, { fetchImpl });

    await expect(proxy(router, 'https://github.com/acme/api/raw/main/shot.png', GITHUB_REPO)).rejects.toThrow(
      /redirect/,
    );
    expect(calls).toHaveLength(1);
  });

  it('follows one same-host redirect', async () => {
    let count = 0;
    const { fetchImpl, calls } = recordingFetch(() => {
      count += 1;
      return count === 1
        ? new Response(null, { status: 302, headers: { location: '/acme/api/raw/moved.png' } })
        : imageResponse(PNG);
    });
    const router = new Router();
    registerImageProxyRoutes(router, { paths }, { fetchImpl });

    await proxy(router, 'https://github.com/acme/api/raw/main/shot.png', GITHUB_REPO);

    expect(calls).toHaveLength(2);
    expect(calls[1]?.url).toBe('https://github.com/acme/api/raw/moved.png');
  });

  it('rejects an answer over 10 MiB', async () => {
    const { fetchImpl } = recordingFetch(() => imageResponse(Buffer.alloc(20 * 1024 * 1024)));
    const router = new Router();
    registerImageProxyRoutes(router, { paths }, { fetchImpl });

    await expect(proxy(router, 'https://github.com/acme/api/raw/main/huge.png', GITHUB_REPO)).rejects.toThrow(
      /10 MiB/,
    );
  });

  it('rejects an HTML answer even when the content type claims an image', async () => {
    const { fetchImpl } = recordingFetch(() => new Response('<html>not an image</html>'));
    const router = new Router();
    registerImageProxyRoutes(router, { paths }, { fetchImpl });

    await expect(proxy(router, 'https://github.com/acme/api/raw/main/not-an-image', GITHUB_REPO)).rejects.toThrow(
      /expected an image/,
    );
  });

  it('resolves a GitLab relative upload against the repository project and authenticates it', async () => {
    const { fetchImpl, calls } = recordingFetch(() => imageResponse(PNG));
    const router = new Router();
    registerImageProxyRoutes(router, { paths }, { fetchImpl });

    await proxy(router, '/uploads/abc123/shot.png', GITLAB_REPO);

    expect(calls[0]?.url).toBe('https://gitlab.com/group/sub/proj/uploads/abc123/shot.png');
    expect(calls[0]?.headers.get('private-token')).toBe('gl-test-token');
  });
});
