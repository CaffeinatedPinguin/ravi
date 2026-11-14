/** Loads data for a component and tracks pending and error state. Small on purpose: no cache, no retries. */
import { useCallback, useEffect, useState } from 'react';

export type AsyncState<T> = {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  reload: () => void;
};

/**
 * Runs `load` when `key` changes and again on `reload()`.
 * `load` must be stable for a given key (wrap it in `useCallback`), because it is not a dependency.
 */
export function useAsync<T>(key: string, load: (signal: AbortSignal) => Promise<T>): AsyncState<T> {
  // The last finished request. "Loading" is derived by comparing it with what is wanted now,
  // so no state has to be reset when the key changes.
  const [settled, setSettled] = useState<{ key: string; attempt: number; data: T | undefined; error: string | null } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setSettled({ key, attempt, data, error: null });
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setSettled({ key, attempt, data: undefined, error: reason instanceof Error ? reason.message : 'Something went wrong' });
        }
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `load` is keyed by `key`; see the doc comment.
  }, [key, attempt]);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);
  // Results of another key must not leak through; results of the same key stay visible during a reload.
  const current = settled?.key === key ? settled : null;
  return { data: current?.data, error: current?.error ?? null, loading: current?.attempt !== attempt, reload };
}
