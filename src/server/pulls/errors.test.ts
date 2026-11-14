import { describe, expect, it } from 'vitest';
import { ForgeError } from '../forges/http.ts';
import { HttpError } from '../http/router.ts';
import { forgeCall, toHttpError } from './errors.ts';

describe('forge error mapping', () => {
  it('keeps the status and repeats the retry delay of a rate limit', () => {
    let thrown: unknown;
    try {
      toHttpError(new ForgeError(429, 'API rate limit exceeded', 30));
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(HttpError);
    expect((thrown as HttpError).status).toBe(429);
    expect((thrown as HttpError).message).toContain('30 s');
  });

  it('keeps a 401 and wraps a rejected forge call', async () => {
    await expect(forgeCall(() => Promise.reject(new ForgeError(401, 'Bad credentials')))).rejects.toMatchObject({
      status: 401,
    });
  });

  it('lets a non-forge error through unchanged', () => {
    const original = new Error('boom');
    let thrown: unknown;
    try {
      toHttpError(original);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBe(original);
  });
});
