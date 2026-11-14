/**
 * A small HTTP client for forge APIs.
 *
 * Security rules that apply to every request: the URL is built by appending the path to the
 * configured API base (never taken from the caller as an absolute URL), redirects are refused
 * because a redirect could carry the token to another host, every call has a timeout, and error
 * messages are scrubbed of authentication headers before they reach a log or the UI.
 */
import type { z } from 'zod';

const REQUEST_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_PAGES = 20;

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** A failed forge call. `message` is safe to show; a token never appears in it. */
export class ForgeError extends Error {
  readonly status: number;
  readonly retryAfterSeconds?: number;

  constructor(status: number, message: string, retryAfterSeconds?: number) {
    super(message);
    this.name = 'ForgeError';
    this.status = status;
    if (retryAfterSeconds !== undefined) {
      this.retryAfterSeconds = retryAfterSeconds;
    }
  }
}

export type ForgeHttp = {
  /** GET one JSON value. With `etag`, a cached value is returned for a 304 answer. */
  get<S extends z.ZodType>(path: string, schema: S, options?: { etag?: boolean }): Promise<z.infer<S>>;
  /** GET every page of a collection, following same-origin `rel="next"` links. */
  getAll<S extends z.ZodType>(path: string, itemSchema: S, options?: { maxPages?: number }): Promise<Array<z.infer<S>>>;
  /** Send a JSON body and validate the JSON answer. */
  send<S extends z.ZodType>(method: string, path: string, body: unknown, schema: S): Promise<z.infer<S>>;
};

export type ForgeHttpOptions = {
  /** API base, e.g. `https://api.github.com` or `https://gitlab.com/api/v4`. */
  apiUrl: string;
  /** Adds authentication headers to the fresh header set of every request. */
  auth: (headers: Headers) => void;
  /** Override for tests; defaults to the global `fetch`. */
  fetchImpl?: FetchLike;
};

export function createForgeHttp({ apiUrl, auth, fetchImpl = fetch }: ForgeHttpOptions): ForgeHttp {
  const base = apiUrl.replace(/\/+$/, '');
  const origin = new URL(base).origin;
  const etagCache = new Map<string, { etag: string; value: unknown }>();

  type Exchange = { response: Response; headers: Headers };

  const request = async (
    method: string,
    url: string,
    body?: unknown,
    extraHeaders?: (headers: Headers) => void,
  ): Promise<Exchange> => {
    const headers = new Headers({ accept: 'application/json' });
    auth(headers);
    extraHeaders?.(headers);
    if (body !== undefined) {
      headers.set('content-type', 'application/json');
    }

    const init: RequestInit = {
      method,
      headers,
      // A token must never follow a redirect chosen by a remote server.
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    let response: Response;
    try {
      response = await fetchImpl(url, init);
    } catch (error) {
      throw new ForgeError(502, redact(`Cannot reach ${new URL(url).host}: ${errorMessage(error)}`, headers));
    }

    // 304 is a cache answer, not a redirect; leave it for `get` to resolve from the ETag cache.
    if (response.status >= 300 && response.status < 400 && response.status !== 304) {
      throw new ForgeError(response.status, `Refusing to follow a redirect (${response.status})`);
    }
    return { response, headers };
  };

  const fail = async (response: Response, headers: Headers): Promise<never> => {
    const text = await response.text().catch(() => '');
    const message = redact(forgeMessage(parseJson(text)) ?? response.statusText ?? '', headers);
    const fallback = message.trim() === '' ? `HTTP ${response.status}` : message;
    throw new ForgeError(response.status, fallback, retryAfterSeconds(response.headers));
  };

  const getAll = async <S extends z.ZodType>(
    path: string,
    itemSchema: S,
    options: { maxPages?: number } = {},
  ): Promise<Array<z.infer<S>>> => {
    const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
    const items: Array<z.infer<S>> = [];
    let next: string | null = resolvePath(path);
    let pages = 0;

    while (next !== null && pages < maxPages) {
      // The token is attached to every request, so a foreign origin is never contacted.
      if (new URL(next).origin !== origin) {
        break;
      }
      const { response, headers } = await request('GET', next);
      if (!response.ok) {
        await fail(response, headers);
      }
      const text = await response.text();
      items.push(...parsePage(text, itemSchema));
      pages += 1;
      next = nextPage(response.headers.get('link'), next);
    }
    return items;
  };

  return {
    async get(path, schema, options = {}) {
      const url = resolvePath(path);
      const cached = etagCache.get(url);
      const { response, headers } = await request('GET', url, undefined, (requestHeaders) => {
        if (cached !== undefined) {
          requestHeaders.set('if-none-match', cached.etag);
        }
      });

      if (response.status === 304) {
        if (cached !== undefined) {
          return cached.value as z.infer<typeof schema>;
        }
        throw new ForgeError(304, 'Not modified, but no cached response exists');
      }
      if (!response.ok) {
        await fail(response, headers);
      }

      const text = await response.text();
      const value = parseJsonValue(text, schema);
      if (options.etag === true) {
        const etag = response.headers.get('etag');
        if (etag !== null && etag !== '') {
          etagCache.set(url, { etag, value });
        } else {
          etagCache.delete(url);
        }
      }
      return value;
    },

    getAll,

    async send(method, path, body, schema) {
      const { response, headers } = await request(method, resolvePath(path), body);
      if (!response.ok) {
        await fail(response, headers);
      }
      const text = await response.text();
      if (text.trim() === '') {
        const parsed = schema.safeParse(undefined);
        if (parsed.success) {
          return parsed.data;
        }
        throw new ForgeError(502, 'Unexpected empty response from the forge');
      }
      return parseJsonValue(text, schema);
    },
  };

  function resolvePath(path: string): string {
    if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith('//')) {
      throw new ForgeError(400, 'Forge request path must be relative');
    }
    if (path.split(/[\\/]/).includes('..')) {
      throw new ForgeError(400, 'Forge request path must not contain ..');
    }
    const url = `${base}${path.startsWith('/') ? '' : '/'}${path}`;
    if (new URL(url).origin !== origin) {
      throw new ForgeError(400, 'Forge request path leaves the API host');
    }
    return url;
  }
}

// ── Response decoding ───────────────────────────────────────────────────────

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function parseJsonValue<S extends z.ZodType>(text: string, schema: S): z.infer<S> {
  const parsed = schema.safeParse(parseJson(text));
  if (!parsed.success) {
    throw new ForgeError(502, 'Unexpected response from the forge');
  }
  return parsed.data;
}

function parsePage<S extends z.ZodType>(text: string, itemSchema: S): Array<z.infer<S>> {
  const parsed = parseJson(text);
  if (!Array.isArray(parsed)) {
    throw new ForgeError(502, 'Unexpected page from the forge');
  }
  return parsed.map((item) => {
    const result = itemSchema.safeParse(item);
    if (!result.success) {
      throw new ForgeError(502, 'Unexpected item from the forge');
    }
    return result.data;
  });
}

function forgeMessage(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) {
    return null;
  }
  const record = body as Record<string, unknown>;
  for (const key of ['message', 'error_description', 'error']) {
    const value = record[key];
    if (typeof value === 'string' && value !== '') {
      return value;
    }
  }
  return null;
}

/**
 * The authentication headers are the only secret the client knows about. Removing them (and their
 * long word parts) from forge text keeps a forge that echoes a token back from leaking it.
 */
function redact(message: string, headers: Headers): string {
  let result = message;
  for (const [name, value] of headers) {
    if (name === 'accept' || name === 'content-type' || name === 'if-none-match') {
      continue;
    }
    result = replaceAll(result, value);
    for (const part of value.split(/\s+/)) {
      if (part.length >= 8) {
        result = replaceAll(result, part);
      }
    }
  }
  return result;
}

function replaceAll(text: string, value: string): string {
  return value === '' ? text : text.split(value).join('[redacted]');
}

function retryAfterSeconds(headers: Headers): number | undefined {
  const retryAfter = headers.get('retry-after');
  if (retryAfter !== null) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.ceil(seconds);
    }
    const date = Date.parse(retryAfter);
    if (!Number.isNaN(date)) {
      return Math.max(0, Math.ceil((date - Date.now()) / 1000));
    }
  }

  for (const name of ['x-ratelimit-reset', 'ratelimit-reset']) {
    const raw = headers.get(name);
    if (raw === null) {
      continue;
    }
    const epochSeconds = Number(raw);
    if (Number.isFinite(epochSeconds)) {
      return Math.max(0, Math.ceil(epochSeconds - Date.now() / 1000));
    }
  }
  return undefined;
}

function nextPage(link: string | null, current: string): string | null {
  if (link === null) {
    return null;
  }
  for (const part of link.split(',')) {
    const match = /<([^>]+)>/.exec(part);
    if (match?.[1] !== undefined && /rel="?[^";]*next/.test(part)) {
      try {
        return new URL(match[1], current).toString();
      } catch {
        return null;
      }
    }
  }
  return null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}
