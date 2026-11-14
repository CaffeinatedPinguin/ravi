import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ForgeError, createForgeHttp } from './http.ts';
import type { FakeRoute } from './testing.ts';
import { fakeFetch } from './testing.ts';

const TOKEN = 'test-token-123';
const API = 'https://api.test';

function make(routes: Record<string, FakeRoute>) {
  const fake = fakeFetch(routes);
  const http = createForgeHttp({
    apiUrl: API,
    auth: (headers) => headers.set('authorization', `Bearer ${TOKEN}`),
    fetchImpl: fake,
  });
  return { http, fake };
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('Expected the request to fail');
    },
    (error: unknown) => error,
  );
}

describe('createForgeHttp', () => {
  it('follows three same-origin pages through Link rel=next', async () => {
    const { http, fake } = make({
      [`GET ${API}/items?page=1`]: {
        json: [1, 2],
        headers: { link: `<${API}/items?page=2>; rel="next"` },
      },
      [`GET ${API}/items?page=2`]: {
        json: [3],
        headers: { link: `<${API}/items?page=3>; rel="next"` },
      },
      [`GET ${API}/items?page=3`]: { json: [4, 5] },
    });

    const items = await http.getAll('/items?page=1', z.number());

    expect(items).toEqual([1, 2, 3, 4, 5]);
    expect(fake.calls).toHaveLength(3);
  });

  it('does not follow a next link to another origin', async () => {
    const { http, fake } = make({
      [`GET ${API}/items`]: {
        json: [1],
        headers: { link: '<https://evil.test/items>; rel="next"' },
      },
    });

    const items = await http.getAll('/items', z.number());

    expect(items).toEqual([1]);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls.some((call) => call.url.includes('evil.test'))).toBe(false);
  });

  it('treats a 302 as an error and never requests the redirect target', async () => {
    const { http, fake } = make({
      [`GET ${API}/moved`]: { status: 302, headers: { location: 'https://evil.test/secret' } },
    });

    const error = await rejection(http.get('/moved', z.object({ ok: z.boolean() })));

    expect(error).toBeInstanceOf(ForgeError);
    expect((error as ForgeError).status).toBe(302);
    expect((error as ForgeError).message).toMatch(/redirect/i);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.redirect).toBe('manual');
    expect(fake.calls.some((call) => call.url.includes('evil.test'))).toBe(false);
  });

  it('reports retry-after and never leaks the token in an error', async () => {
    const { http } = make({
      [`GET ${API}/limited`]: {
        status: 429,
        headers: { 'retry-after': '30' },
        json: { message: `Too many requests for ${TOKEN}` },
      },
    });

    const error = await rejection(http.get('/limited', z.object({ ok: z.boolean() })));

    expect(error).toBeInstanceOf(ForgeError);
    const forgeError = error as ForgeError;
    expect(forgeError.status).toBe(429);
    expect(forgeError.retryAfterSeconds).toBe(30);
    expect(forgeError.message).not.toContain(TOKEN);
    expect(JSON.stringify(forgeError)).not.toContain(TOKEN);
  });

  it('returns the cached value for a 304 ETag answer and sends If-None-Match', async () => {
    let calls = 0;
    const { http, fake } = make({
      [`GET ${API}/etag`]: () => {
        calls += 1;
        return calls === 1 ? { json: { value: 1 }, headers: { etag: '"v1"' } } : { status: 304 };
      },
    });
    const schema = z.object({ value: z.number() });

    const first = await http.get('/etag', schema, { etag: true });
    const second = await http.get('/etag', schema, { etag: true });

    expect(first).toEqual({ value: 1 });
    expect(second).toEqual({ value: 1 });
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[1]?.headers['if-none-match']).toBe('"v1"');
  });

  it('refuses absolute URLs and paths that contain ..', async () => {
    const { http, fake } = make({});

    await expect(http.get('https://evil.test/steal', z.unknown())).rejects.toThrow(/relative/);
    await expect(http.get('/repos/../secrets', z.unknown())).rejects.toThrow(/\.\./);
    expect(fake.calls).toHaveLength(0);
  });

  it('sends JSON bodies for writes and validates the answer', async () => {
    const { http, fake } = make({
      [`POST ${API}/comments`]: { status: 201, json: { id: 'c1' } },
    });

    const result = await http.send('POST', '/comments', { body: 'hello' }, z.object({ id: z.string() }));

    expect(result).toEqual({ id: 'c1' });
    expect(fake.calls[0]?.headers['content-type']).toBe('application/json');
    expect(fake.calls[0]?.body).toBe('{"body":"hello"}');
  });
});
