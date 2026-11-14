/**
 * `?thread=<id>` on the pull request page: switch to the tab that holds the thread and bring it
 * into view. Inbox and desktop notifications link here, so a click lands on the new comment.
 */
import { useEffect, useRef } from 'react';
import type { DiffFile } from '../../../shared/api.ts';
import type { Thread } from '../../../shared/forge.ts';
import { useUrl } from '../../app/router.ts';

export function useThreadScroll(
  threads: readonly Thread[],
  tab: 'files' | 'conversation',
  openTab: (tab: 'files' | 'conversation') => void,
  files: readonly DiffFile[],
  openFile: (index: number) => void,
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

    if (thread.path !== null) {
      // Inline threads live inside the diff, whose rows do not expose a stable DOM id; opening the
      // right file is the closest the UI can get without changing the comment components.
      if (tab !== 'files') {
        openTab('files');
        return;
      }
      const index = files.findIndex((file) => file.path === thread.path);
      if (index >= 0) {
        openFile(index);
      }
      handled.current = threadId;
      return;
    }

    if (tab !== 'conversation') {
      openTab('conversation');
      return;
    }
    const element = document.getElementById(`thread-${threadId}`);
    if (element === null) {
      return;
    }
    handled.current = threadId;
    element.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [threadId, threads, tab, openTab, files, openFile]);
}
