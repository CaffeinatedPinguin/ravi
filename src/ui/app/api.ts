/**
 * The only place the UI talks HTTP. Every response is validated against a shared Zod schema,
 * so a server/UI mismatch fails loudly here instead of deep inside a component.
 */
import type { z } from 'zod';
import { CSRF_HEADER } from '../../shared/api.ts';

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function apiGet<S extends z.ZodType>(path: string, schema: S, signal?: AbortSignal): Promise<z.infer<S>> {
  return parse(await fetch(path, { signal }), schema);
}

export async function apiSend<S extends z.ZodType>(
  method: 'POST' | 'PUT' | 'DELETE',
  path: string,
  body: unknown,
  schema: S,
): Promise<z.infer<S>> {
  const response = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json', [CSRF_HEADER]: '1' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return parse(response, schema);
}

async function parse<S extends z.ZodType>(response: Response, schema: S): Promise<z.infer<S>> {
  if (!response.ok) {
    throw new ApiError(response.status, await errorMessage(response));
  }
  const payload: unknown = response.status === 204 ? undefined : await response.json();
  return schema.parse(payload);
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const payload: unknown = await response.json();
    if (typeof payload === 'object' && payload !== null && 'error' in payload && typeof payload.error === 'string') {
      return payload.error;
    }
  } catch {
    // Not JSON: fall through to the status text.
  }
  return response.statusText || `Request failed (${response.status})`;
}
