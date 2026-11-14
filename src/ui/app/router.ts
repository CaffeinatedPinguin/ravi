/** A few lines of routing on top of the History API; the app has too few screens to need a library. */
import { useSyncExternalStore } from 'react';

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener('popstate', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('popstate', listener);
  };
}

const currentUrl = () => window.location.pathname + window.location.search;

/** The current path and query string; components re-render when it changes. */
export function useUrl(): URL {
  return new URL(useSyncExternalStore(subscribe, currentUrl), window.location.origin);
}

export function navigate(to: string, options: { replace?: boolean } = {}): void {
  if (to === currentUrl()) {
    return;
  }
  if (options.replace) {
    window.history.replaceState(null, '', to);
  } else {
    window.history.pushState(null, '', to);
  }
  for (const listener of listeners) {
    listener();
  }
}
