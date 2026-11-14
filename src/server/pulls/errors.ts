/** Maps a failed forge call to the HTTP answer; keep this the only place that knows `ForgeError`. */
import { ForgeError } from '../forges/http.ts';
import { HttpError } from '../http/router.ts';

/**
 * Forge failures are request failures for the UI. A 429 carries no header to the browser, so the
 * wait is repeated in the message; anything that is not a `ForgeError` keeps its own behaviour.
 */
export function toHttpError(error: unknown): never {
  if (error instanceof ForgeError) {
    const retry = error.retryAfterSeconds === undefined ? '' : ` (retry after ${error.retryAfterSeconds} s)`;
    throw new HttpError(error.status, `${error.message}${retry}`);
  }
  throw error;
}

export async function forgeCall<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    return toHttpError(error);
  }
}
