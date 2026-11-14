/**
 * Persistence for notifications: one small JSON file in the data folder.
 *
 * The file is a bounded cache, not the source of truth. Markers remember which comments were
 * already handled per pull request, `recent` feeds the filter preview, and `items` is the list the
 * UI reads. Every array is capped on write so a long-running server cannot grow the file forever.
 */
import { join } from 'node:path';
import { z } from 'zod';
import {
  MAX_NOTIFICATIONS,
  MAX_RECENT_COMMENTS,
  NotificationSchema,
} from '../../shared/notify.ts';
import type {
  Notification,
  NotificationFilters,
  NotificationList,
  NotificationPreview,
  NotificationReadRequest,
} from '../../shared/notify.ts';
import type { Paths } from '../paths.ts';
import { readJsonFile, writeJsonFile } from '../store/json-file.ts';
import { shouldNotify } from './filter.ts';

/** A comment the poller has seen, whether it notified or not; the preview filters over these. */
export const RecentCommentSchema = z.object({
  id: z.string(),
  repoId: z.string(),
  host: z.string(),
  project: z.string(),
  number: z.number().int().positive(),
  author: z.string(),
  body: z.string(),
  createdAt: z.string(),
  /** Login of the poller run; the preview uses it to keep "my own comments" out of the count. */
  viewer: z.string().default(''),
});
export type RecentComment = z.infer<typeof RecentCommentSchema>;

export const NotificationMarkerSchema = z.object({
  lastCheckedAt: z.string(),
  seenIds: z.array(z.string()),
});
export type NotificationMarker = z.infer<typeof NotificationMarkerSchema>;

export const NotificationStoreSchema = z.object({
  markers: z.record(z.string(), NotificationMarkerSchema).default({}),
  items: z.array(NotificationSchema).default([]),
  recent: z.array(RecentCommentSchema).default([]),
});
export type NotificationStore = z.infer<typeof NotificationStoreSchema>;

const file = (paths: Paths): string => join(paths.data, 'notifications.json');

export function readNotificationStore(paths: Paths): Promise<NotificationStore> {
  return readJsonFile(file(paths), NotificationStoreSchema, NotificationStoreSchema.parse({}));
}

export function writeNotificationStore(paths: Paths, store: NotificationStore): Promise<void> {
  return writeJsonFile(file(paths), store);
}

export async function listNotifications(paths: Paths): Promise<NotificationList> {
  return toList(await readNotificationStore(paths));
}

export async function markNotificationsRead(
  paths: Paths,
  request: NotificationReadRequest,
): Promise<NotificationList> {
  const store = await readNotificationStore(paths);
  // `null` means "all"; otherwise only the named ids change.
  const ids = 'ids' in request ? new Set(request.ids) : null;
  store.items = store.items.map((item) =>
    ids === null || ids.has(item.id) ? { ...item, read: true } : item,
  );
  await writeNotificationStore(paths, store);
  return toList(store);
}

export async function previewNotifications(
  paths: Paths,
  filters: NotificationFilters,
): Promise<NotificationPreview> {
  const store = await readNotificationStore(paths);
  const matched = store.recent.filter((comment) =>
    shouldNotify({ author: comment.author, body: comment.body }, filters, comment.viewer),
  ).length;
  return { matched, total: store.recent.length };
}

/** Newest first, capped at the contract limit even if a hand-edited file has more. */
function toList(store: NotificationStore): NotificationList {
  const items = [...store.items].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const capped = items.slice(0, MAX_NOTIFICATIONS);
  return { items: capped, unread: capped.filter((item) => !item.read).length };
}

/** Adds a seen comment once; a repeated id (a forge page overlap) must not duplicate the preview. */
export function addRecent(store: NotificationStore, comment: RecentComment): void {
  if (store.recent.some((item) => item.id === comment.id)) {
    return;
  }
  store.recent.push(comment);
  store.recent.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  store.recent = store.recent.slice(0, MAX_RECENT_COMMENTS);
}

/** Adds a notification once and keeps the newest 500. */
export function addNotification(store: NotificationStore, notification: Notification): void {
  if (store.items.some((item) => item.id === notification.id)) {
    return;
  }
  store.items.push(notification);
  store.items.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  store.items = store.items.slice(0, MAX_NOTIFICATIONS);
}
