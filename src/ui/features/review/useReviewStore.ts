/** The open review document: one store per target, loaded once and watched by the screen. */
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { ReviewTarget } from '../../../shared/review.ts';
import { ReviewStore } from '../comments/reviewStore.ts';

const NO_SUBSCRIBE = () => () => undefined;
const ZERO = () => 0;

export type ReviewStoreState = {
  store: ReviewStore | null;
  /** Bumped on every document/save change; reading it makes the screen re-render. */
  version: number;
};

export function useReviewStore(repoId: string, target: ReviewTarget | null): ReviewStoreState {
  const store = useMemo(() => (target === null ? null : new ReviewStore(repoId, target)), [repoId, target]);
  useEffect(() => {
    if (store) {
      void store.load();
    }
  }, [store]);
  const version = useSyncExternalStore(store?.subscribe ?? NO_SUBSCRIBE, store?.getVersion ?? ZERO);

  useEffect(() => {
    if (!store) {
      return;
    }
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!store.hasUnsaved) {
        return;
      }
      store.flush();
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [store]);

  return { store, version };
}
