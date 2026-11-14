/**
 * Server-side image proxy for comments.
 *
 * Reasons it exists: a comment body is untrusted (forge/import), so a direct `<img src>` would let
 * the page leak the user's IP and reading behaviour to any host, and private GitHub/GitLab uploads
 * need the forge token which must never reach the browser. The proxy therefore accepts only a
 * fixed allowlist of forge web/image hosts, refuses IP literals, follows at most one same-host
 * redirect and attaches a forge token only to that forge's own host. (SSRF / tracking pixels.)
 */
import { isIP } from 'node:net';
import type { Repo } from '../../shared/api.ts';
import type { AppContext } from '../app.ts';
import { HOSTS } from '../forges/registry.ts';
import type { FetchLike } from '../forges/http.ts';
import { readForgeTokens } from '../forges/env.ts';
import { HttpError, raw } from '../http/router.ts';
import type { Router } from '../http/router.ts';
import { SECURITY_HEADERS } from '../http/static.ts';
import type { Paths } from '../paths.ts';
import { detectImageType } from '../review/assets.ts';
import { getRepo } from '../store/repos.ts';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;
const IMAGE_ACCEPT = 'image/png,image/jpeg,image/gif,image/webp';

/** Hosts that serve avatars/uploaded images; `github.com`/`gitlab.com` come from the registry. */
const IMAGE_HOSTS = [
  'avatars.githubusercontent.com',
  'private-user-images.githubusercontent.com',
  'user-images.githubusercontent.com',
];

const ALLOWED_HOSTS = new Set([...HOSTS.map((host) => new URL(host.webUrl).hostname), ...IMAGE_HOSTS]);

export type ImageProxyOptions = {
  /** Test seam: replaces the network so the gate never touches a real host. */
  fetchImpl?: FetchLike;
};

export function registerImageProxyRoutes(
  router: Router,
  { paths }: AppContext,
  options: ImageProxyOptions = {},
): void {
  const fetchImpl = options.fetchImpl ?? fetch;

  router.get('/api/image-proxy', async ({ query }) => {
    const source = query.get('url');
    if (source === null || source.trim() === '') {
      throw new HttpError(400, 'Missing image URL');
    }
    const repo = await getRepo(paths, query.get('repo') ?? '');
    const target = resolveTarget(repo, source);
    assertAllowed(target);

    const headers = await authHeaders(paths, target);
    const response = await fetchImage(target, headers, fetchImpl);
    const data = await readBody(response, MAX_IMAGE_BYTES);
    const type = detectImageType(data);
    if (type === null) {
      throw new HttpError(415, 'Image proxy expected an image');
    }
    return raw(
      200,
      {
        ...SECURITY_HEADERS,
        // The URL may embed a private-upload id; only the user's own browser may cache it.
        'cache-control': 'private, max-age=3600',
        'content-type': type,
      },
      data,
    );
  });
}

/**
 * GitLab writes uploads as `/uploads/<hash>/name.png`; they are relative to the project page, so
 * the project path from the connected repository supplies the missing prefix.
 */
function resolveTarget(repo: Repo, source: string): URL {
  const value = source.trim();
  if (value.startsWith('//')) {
    throw new HttpError(400, 'Protocol-relative image URLs are not proxied');
  }
  if (!/^[a-z][a-z0-9+.-]*:/i.test(value)) {
    const remote = repo.remote;
    const host = HOSTS.find((candidate) => candidate.host === remote?.host);
    if (remote === null || host === undefined || !value.startsWith('/uploads/')) {
      throw new HttpError(400, 'Only absolute https image URLs are proxied');
    }
    return new URL(value.replace(/^\/+/, ''), `${host.webUrl}/${remote.project}/`);
  }
  try {
    return new URL(value);
  } catch {
    throw new HttpError(400, 'Invalid image URL');
  }
}

/** No IP literals (metadata services), no credentials, no ports, and only the known hosts. */
function assertAllowed(url: URL): void {
  if (url.protocol !== 'https:') {
    throw new HttpError(400, 'Image proxy only accepts https URLs');
  }
  if (url.username !== '' || url.password !== '' || url.port !== '') {
    throw new HttpError(400, 'Image proxy rejects credentials and explicit ports');
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (isIP(host) !== 0 || !ALLOWED_HOSTS.has(host)) {
    throw new HttpError(400, `Host is not allowed for images: ${host}`);
  }
}

/** The token never leaves the forge it belongs to, so an image host gets a bare request. */
async function authHeaders(paths: Paths, target: URL): Promise<Headers> {
  const headers = new Headers({ accept: IMAGE_ACCEPT });
  const owner = HOSTS.find((candidate) => new URL(candidate.webUrl).hostname === target.hostname);
  if (owner === undefined) {
    return headers;
  }
  const token = (await readForgeTokens(paths.envFile)).get(owner.tokenEnv);
  if (token !== undefined) {
    owner.auth(token, headers);
    // The forge auth helpers set their API media type; this request wants bytes, not JSON.
    headers.set('accept', IMAGE_ACCEPT);
  }
  return headers;
}

async function fetchImage(start: URL, headers: Headers, fetchImpl: FetchLike): Promise<Response> {
  let response = await request(start, headers, fetchImpl);
  if (isRedirect(response.status)) {
    const location = response.headers.get('location');
    if (location === null) {
      throw new HttpError(502, 'Image redirect without a Location');
    }
    let next: URL;
    try {
      next = new URL(location, start);
    } catch {
      throw new HttpError(502, 'Invalid image redirect');
    }
    // A redirect could otherwise move the request (and the token) to an arbitrary host.
    if (next.hostname !== start.hostname) {
      throw new HttpError(502, 'Refusing to follow an image redirect to another host');
    }
    assertAllowed(next);
    response = await request(next, headers, fetchImpl);
    if (isRedirect(response.status)) {
      throw new HttpError(502, 'Refusing more than one image redirect');
    }
  }
  if (!response.ok) {
    throw new HttpError(response.status === 404 ? 404 : 502, `Image request failed (${response.status})`);
  }
  return response;
}

async function request(url: URL, headers: Headers, fetchImpl: FetchLike): Promise<Response> {
  try {
    return await fetchImpl(url.toString(), {
      method: 'GET',
      headers,
      // The token must not follow a Location chosen by a remote server.
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    throw new HttpError(502, `Cannot reach ${url.hostname}: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
}

/** Streams with a hard cap so a missing/lying content-length cannot exhaust memory. */
async function readBody(response: Response, limit: number): Promise<Buffer> {
  const declared = Number(response.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > limit) {
    throw new HttpError(413, 'Image is larger than 10 MiB');
  }
  const body = response.body as ReadableStream<Uint8Array> | null;
  if (body === null) {
    return Buffer.alloc(0);
  }
  const reader: ReadableStreamDefaultReader<Uint8Array> = body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new HttpError(413, 'Image is larger than 10 MiB');
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size);
}

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400;
}
