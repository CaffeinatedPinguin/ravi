/**
 * `?thread=<id>` on the pull request page: switch to the tab that holds the thread and bring it
 * into view. Inbox and desktop notifications link here, so a click lands on the new comment.
 */
import { useEffect, useRef } from 'react';
import type { Thread } from '../../../shared/forge.ts';
import { useUrl } from '../../app/router.ts';
import type { DiffSession } from '../diff/session.ts';
import { scrollToThread } from './threadScroll.ts';
import type { ThreadScrollHandle } from './threadScroll.ts';
import { locateThread } from './threadTarget.ts';

export type ThreadScrollOptions = {
  session: DiffSession | null;
  /** Read lazily: the diff handle is null until DiffView mounts. */
  handle: () => ThreadScrollHandle | null;
};

export function useThreadScroll(
  threads: readonly Thread[],
  tab: 'files' | 'conversation',
  openTab: (tab: 'files' | 'conversation') => void,
  { session, handle }: ThreadScrollOptions,
): void {
  const handled = useRef<string | null>(null);
  const threadId = useUrl().searchParams.get('thread');

  useEffect(() => {
    if (threadId === null || handled.current === threadId) {
      return;
    }
    const thread = threads.find((candidate) => candidate.id === threadId);
    if (thread === undefined) {
      return;
    }

    const target = locateThread(thread, session);
    if (target?.kind === 'conversation') {
      if (tab !== 'conversation') {
        openTab('conversation');
        return;
      }
      handled.current = threadId;
      focusThread(threadId, true);
      return;
    }

    if (tab !== 'files') {
      openTab('files');
      return;
    }
    const outcome = scrollToThread(threadId, threads, session, handle());
    if (outcome === 'missing') {
      // The session may not have the thread rows yet; a later render retries this effect.
      return;
    }
    handled.current = threadId;
    requestAnimationFrame(() => focusThread(threadId, false));
  }, [threadId, threads, tab, openTab, session, handle]);
}

/**
 * Thread rows get `tabIndex={-1}`, so they can take focus. A virtualized row may need a frame (or
 * two) before it exists; conversation threads still need `scrollIntoView` because no virtualizer
 * moved them.
 */
function focusThread(threadId: string, scroll: boolean, attempts = 2): void {
  const element = document.getElementById(`thread-${threadId}`);
  if (element === null) {
    if (attempts > 0) {
      requestAnimationFrame(() => focusThread(threadId, scroll, attempts - 1));
    }
    return;
  }
  if (scroll) {
    element.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  element.focus({ preventScroll: true });
}
