/**
 * Keeps a local review fresh: when the window is focused again, the server fingerprint is compared
 * with the one taken at the last load, and only a real change triggers a reload.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { FingerprintSchema } from '../../../shared/api.ts';
import type { DiffTarget } from '../../../shared/api.ts';
import { apiSend } from '../../app/api.ts';

/** A fingerprint comparison is the whole decision; extracting it keeps that rule unit-testable. */
export function shouldReloadOnFocus(loadedFingerprint: string, currentFingerprint: string): boolean {
  return loadedFingerprint !== currentFingerprint;
}

/**
 * Age of the last refresh, used in the save-status tooltip and the reload button's aria-label.
 * Pure so the thresholds can be tested; a clock that moves backwards reads "just now".
 */
export function formatRefreshedAgo(now: number, updatedAt: number): string {
  const seconds = Math.max(0, Math.floor((now - updatedAt) / 1000));
  if (seconds < 5) {
    return 'just now';
  }
  if (seconds < 60) {
    return `${seconds} s ago`;
  }
  return `${Math.floor(seconds / 60)} min ago`;
}

type AutoRefreshOptions = {
  repoId: string;
  target: DiffTarget;
  /** Changes each time the diff is (re)loaded; a new value takes a fresh baseline fingerprint. */
  loaded: unknown;
  onReload: () => void;
};

/** Returns when the visible diff was loaded, or `null` before the first successful load. */
export function useAutoRefresh({ repoId, target, loaded, onReload }: AutoRefreshOptions): number | null {
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const targetRef = useRef(target);
  const onReloadRef = useRef(onReload);
  const baseline = useRef<{ key: string; fingerprint: string } | null>(null);
  // A promise chain serializes probes: at most one fingerprint request is in flight, and a focus
  // that arrives during a load waits for that load's baseline instead of racing it.
  const queue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    targetRef.current = target;
    onReloadRef.current = onReload;
  });

  const enqueue = useCallback(
    (run: (fingerprint: string, key: string) => void) => {
      queue.current = queue.current.then(async () => {
        const currentTarget = targetRef.current;
        const key = JSON.stringify(currentTarget);
        try {
          const { fingerprint } = await apiSend('POST', `/api/repos/${repoId}/fingerprint`, { target: currentTarget }, FingerprintSchema);
          run(fingerprint, key);
        } catch {
          // A failed probe must not break reviewing; the next focus simply tries again.
        }
      });
    },
    [repoId],
  );

  useEffect(() => {
    if (loaded === undefined) {
      return;
    }
    const key = JSON.stringify(target);
    enqueue((fingerprint, probedKey) => {
      // A result for a target the user already left must not become the new baseline.
      if (probedKey === key) {
        baseline.current = { key, fingerprint };
        setUpdatedAt(Date.now());
      }
    });
  }, [loaded, target, enqueue]);

  useEffect(() => {
    const check = () => {
      // A hidden tab has nothing to keep in sync, and the probe would only waste a request.
      if (document.visibilityState === 'hidden') {
        return;
      }
      enqueue((fingerprint, key) => {
        const known = baseline.current;
        if (known !== null && known.key === key && shouldReloadOnFocus(known.fingerprint, fingerprint)) {
          // Remember the new state before reloading: further focus events while the request runs
          // must not queue a second reload for the same change.
          baseline.current = { key, fingerprint };
          onReloadRef.current();
        }
      });
    };
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, [enqueue]);

  return updatedAt;
}
