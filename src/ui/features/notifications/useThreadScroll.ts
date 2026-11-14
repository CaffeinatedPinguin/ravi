/**
 * `?thread=<id>` on the pull request page: switch to the tab that holds the thread and bring it
 * into view. Inbox and desktop notifications link here, so a click lands on the new comment.
 */
import { useEffect, useRef } from 'react';
import type { Thread } from '../../../shared/forge.ts';
import { useUrl } from '../../app/router.ts';
import type { DiffSession } from '../diff/session.ts';
import { locateThread } from './threadTarget.ts';

export type ThreadScrollOptions = {
  session: DiffSession | null;
  /**
   * Row scroll from the virtualizer; the row may not be rendered yet, so a DOM lookup alone is not
   * enough. `fileIndex` lets the caller fall back when the view has no row scrolling yet.
   */
  scrollToRow: (rowIndex: number, fileIndex: number) => void;
};

export function useThreadScroll(
  threads: readonly Thread[],
  tab: 'files' | 'conversation',
  openTab: (tab: 'files' | 'conversation') => void,
  { session, scrollToRow }: ThreadScrollOptions,
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
    if (target === null) {
      return;
    }

    if (target.kind === 'conversation') {
      if (tab !== 'conversation') {
        openTab('conversation');
        return;
      }
      handled.current = threadId;
      focusThread(threadId);
      return;
    }

    if (tab !== 'files') {
      openTab('files');
      return;
    }
    handled.current = threadId;
    scrollToRow(target.rowIndex, target.fileIndex);
    requestAnimationFrame(() => focusThread(threadId));
  }, [threadId, threads, tab, openTab, session, scrollToRow]);
}

/** Thread rows get `tabIndex={-1}`, so they can take focus after the virtualizer reveals them. */
function focusThread(threadId: string): void {
  const element = document.getElementById(`thread-${threadId}`);
  if (element === null) {
    return;
  }
  element.scrollIntoView({ block: 'center', behavior: 'smooth' });
  element.focus({ preventScroll: true });
}
