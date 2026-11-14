/**
 * A fake `fetch` for strategy tests. Tests never touch a real forge: every request has to match a
 * route in the supplied table, and an unknown request fails the test immediately.
 */
import type { FetchLike } from './http.ts';

export type FakeResponse = {
  /** HTTP status; 200 when omitted. */
  status?: number;
  /** Response headers, e.g. `etag` or `link`. */
  headers?: Record<string, string>;
  /** JSON body; serialised for the fake response. */
  json?: unknown;
  /** Raw body when the answer is not JSON. */
  body?: string;
};

export type FakeCall = {
  /** Uppercased HTTP method. */
  method: string;
  /** Full request URL. */
  url: string;
  /** Request headers with lowercased names. */
  headers: Record<string, string>;
  /** Request body as sent, or null. */
  body: string | null;
  /** Redirect mode, so a test can prove the client asked for manual handling. */
  redirect: string | undefined;
};

/** A route either has one fixed answer or computes it from the request (for ETag sequences). */
export type FakeRoute = FakeResponse | ((call: FakeCall) => FakeResponse);

/** The callable fake plus the recorded calls; `.fetch` and `.fetchImpl` support both usage styles. */
export type FakeFetch = FetchLike & { calls: FakeCall[]; fetch: FetchLike; fetchImpl: FetchLike };

export function fakeFetch(routes: Record<string, FakeRoute>): FakeFetch {
  const calls: FakeCall[] = [];

  const fetchImpl: FetchLike = (url, init) => {
    const call: FakeCall = {
      method: (init.method ?? 'GET').toUpperCase(),
      url,
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      body: typeof init.body === 'string' ? init.body : null,
      redirect: init.redirect,
    };
    calls.push(call);

    const route = routes[`${call.method} ${call.url}`];
    if (route === undefined) {
      return Promise.reject(new Error(`Unexpected request: ${call.method} ${call.url}`));
    }

    const answer = typeof route === 'function' ? route(call) : route;
    const status = answer.status ?? 200;
    const body = answer.json !== undefined ? JSON.stringify(answer.json) : (answer.body ?? null);
    // Response forbids a body for these statuses.
    const allowed = status !== 204 && status !== 304;
    return Promise.resolve(new Response(allowed ? body : null, { status, headers: new Headers(answer.headers) }));
  };

  return Object.assign(fetchImpl, { calls, fetch: fetchImpl, fetchImpl });
}
