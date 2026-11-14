/**
 * A deliberately tiny router: exact method + path patterns with `:params`, JSON in, JSON out.
 * It exists so the server needs no web framework; keep it boring.
 */
import type { IncomingMessage } from 'node:http';
import type { z } from 'zod';

/** Thrown by handlers to answer with a specific status; anything else becomes a 500. */
export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** A non-JSON answer (static asset, redirect, plain text). */
export type RawResponse = {
  raw: true;
  status: number;
  headers: Record<string, string>;
  body?: Buffer | string;
};

export function raw(status: number, headers: Record<string, string>, body?: Buffer | string): RawResponse {
  return { raw: true, status, headers, body };
}

export type RequestContext = {
  req: IncomingMessage;
  params: Record<string, string>;
  query: URLSearchParams;
  /** Reads and validates the JSON body; a malformed body is a 400, never a crash. */
  body: <S extends z.ZodType>(schema: S) => Promise<z.infer<S>>;
};

/** Handlers return a JSON-serialisable value, a `RawResponse`, or nothing (204). */
export type Handler = (context: RequestContext) => unknown;

type Route = { method: string; segments: string[]; handler: Handler };

const MAX_BODY_BYTES = 32 * 1024 * 1024;

export class Router {
  private readonly routes: Route[] = [];

  get(path: string, handler: Handler): this {
    return this.add('GET', path, handler);
  }

  post(path: string, handler: Handler): this {
    return this.add('POST', path, handler);
  }

  put(path: string, handler: Handler): this {
    return this.add('PUT', path, handler);
  }

  delete(path: string, handler: Handler): this {
    return this.add('DELETE', path, handler);
  }

  match(method: string, pathname: string): { handler: Handler; params: Record<string, string> } | null {
    const segments = splitPath(pathname);
    for (const route of this.routes) {
      if (route.method !== method || route.segments.length !== segments.length) {
        continue;
      }
      const params = matchSegments(route.segments, segments);
      if (params) {
        return { handler: route.handler, params };
      }
    }
    return null;
  }

  private add(method: string, path: string, handler: Handler): this {
    this.routes.push({ method, segments: splitPath(path), handler });
    return this;
  }
}

function splitPath(path: string): string[] {
  return path.split('/').filter(Boolean);
}

function matchSegments(pattern: string[], actual: string[]): Record<string, string> | null {
  const params: Record<string, string> = {};
  for (const [index, part] of pattern.entries()) {
    const value = actual[index];
    if (value === undefined) {
      return null;
    }
    if (part.startsWith(':')) {
      params[part.slice(1)] = decodeURIComponent(value);
    } else if (part !== value) {
      return null;
    }
  }
  return params;
}

export async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw new HttpError(413, 'Request body too large');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function readJsonBody<S extends z.ZodType>(req: IncomingMessage, schema: S): Promise<z.infer<S>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse((await readBody(req)).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Request body is not valid JSON');
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    const details = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new HttpError(400, `Invalid request: ${details}`);
  }
  return result.data;
}
