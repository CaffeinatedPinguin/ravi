/**
 * Notification contract shared by the server and the UI.
 *
 * Filter rules are plain strings, never patterns: the poller and the preview run
 * `body.toLowerCase().includes(entry.toLowerCase())` over in-memory JSON. A rule such as `.*`,
 * `%` or `$(rm -rf /)` therefore stays literal text and can never become a regex, SQL or a shell
 * command. Lengths and list sizes are capped here so both sides agree on the limits.
 */
import { z } from 'zod';

export const MAX_FILTER_ENTRIES = 100;
export const MAX_FILTER_TEXT = 200;
export const MAX_NOTIFICATIONS = 500;
export const MAX_RECENT_COMMENTS = 200;
export const MAX_SEEN_IDS = 2000;

/** GitHub and GitLab login characters; anything else could not name a forge account. */
export const AUTHOR_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

const authorEntry = z.string().trim().min(1).max(100).regex(AUTHOR_PATTERN, 'Invalid author login');
const textEntry = z.string().trim().min(1).max(MAX_FILTER_TEXT);
const authorList = z.array(authorEntry).max(MAX_FILTER_ENTRIES).default([]);
const textList = z.array(textEntry).max(MAX_FILTER_ENTRIES).default([]);

/** The rules the poller applies; also the body of the preview request. */
export const NotificationFiltersSchema = z.object({
  muteBots: z.boolean().default(true),
  mutedAuthors: authorList,
  onlyFrom: authorList,
  includeText: textList,
  excludeText: textList,
});
export type NotificationFilters = z.infer<typeof NotificationFiltersSchema>;

/** One notified comment; `excerpt` is prepared by the poller so the UI never renders a whole body. */
export const NotificationSchema = z.object({
  id: z.string(),
  repoId: z.string(),
  host: z.string(),
  project: z.string(),
  number: z.number().int().positive(),
  prTitle: z.string(),
  threadId: z.string(),
  commentId: z.string(),
  author: z.string(),
  excerpt: z.string().max(200),
  createdAt: z.string(),
  read: z.boolean(),
});
export type Notification = z.infer<typeof NotificationSchema>;

/** `GET /api/notifications` and the answer of the poll and read routes. */
export const NotificationListSchema = z.object({
  items: z.array(NotificationSchema),
  unread: z.number().int().nonnegative(),
});
export type NotificationList = z.infer<typeof NotificationListSchema>;

export const NotificationReadRequestSchema = z.union([
  z.object({ ids: z.array(z.string()).max(MAX_NOTIFICATIONS) }),
  z.object({ all: z.literal(true) }),
]);
export type NotificationReadRequest = z.infer<typeof NotificationReadRequestSchema>;

export const NotificationPreviewRequestSchema = z.object({ filters: NotificationFiltersSchema });
export type NotificationPreviewRequest = z.infer<typeof NotificationPreviewRequestSchema>;

/** How many of the last comments seen would pass the given rules. */
export const NotificationPreviewSchema = z.object({
  matched: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});
export type NotificationPreview = z.infer<typeof NotificationPreviewSchema>;
