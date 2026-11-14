/**
 * Pure rules for the notification inbox. Keeping them free of React and the browser makes the
 * "notify only once" promise testable without rendering.
 */
import { MAX_SEEN_IDS } from '../../../shared/notify.ts';
import type { Notification } from '../../../shared/notify.ts';

/**
 * Items worth a desktop notification: unread, not present in the previous poll and never shown
 * before. `previousIds === null` is the first load after opening revu; existing items are the
 * baseline and must stay quiet.
 */
export function notificationsToShow(
  previousIds: ReadonlySet<string> | null,
  items: readonly Notification[],
  shownIds: ReadonlySet<string>,
): Notification[] {
  if (previousIds === null) {
    return [];
  }
  return items.filter((item) => !item.read && !previousIds.has(item.id) && !shownIds.has(item.id));
}

export type DesktopMessage = { title: string; body: string; tag: string };

/**
 * A browser notification carries plain text only: the tag de-duplicates at the OS level and the
 * body is the same excerpt the inbox shows, never HTML.
 */
export function desktopNotification(item: Notification): DesktopMessage {
  return {
    title: item.author,
    body: `${item.prTitle} #${item.number}\n${item.excerpt}`,
    tag: item.id,
  };
}

/** Inbox rows and desktop notifications open the pull request at the thread that changed. */
export function notificationTarget(item: Pick<Notification, 'repoId' | 'number' | 'threadId'>): string {
  return `/repo/${encodeURIComponent(item.repoId)}/pull/${item.number}?thread=${encodeURIComponent(item.threadId)}`;
}

/** The in-memory "shown" set must stay bounded on a long-lived tab; Set keeps insertion order. */
export function rememberShown(shown: Set<string>, ids: readonly string[]): void {
  for (const id of ids) {
    shown.add(id);
  }
  while (shown.size > MAX_SEEN_IDS) {
    const oldest = shown.values().next().value;
    if (oldest === undefined) {
      break;
    }
    shown.delete(oldest);
  }
}
