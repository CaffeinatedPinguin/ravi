/** Routes for the notification inbox, the manual poll and the filter preview. */
import {
  NotificationPreviewRequestSchema,
  NotificationReadRequestSchema,
} from '../../shared/notify.ts';
import type { AppContext } from '../app.ts';
import type { Router } from '../http/router.ts';
import { pollOnce } from '../notify/poller.ts';
import {
  listNotifications,
  markNotificationsRead,
  previewNotifications,
} from '../notify/store.ts';

export function registerNotificationRoutes(router: Router, { paths }: AppContext): void {
  router.get('/api/notifications', () => listNotifications(paths));

  router.post('/api/notifications/read', async ({ body }) =>
    markNotificationsRead(paths, await body(NotificationReadRequestSchema)),
  );

  // "Run now" uses the same pass as the background poller, then returns the inbox the UI needs.
  router.post('/api/notifications/poll', async () => {
    await pollOnce(paths);
    return listNotifications(paths);
  });

  router.post('/api/notifications/preview', async ({ body }) => {
    const { filters } = await body(NotificationPreviewRequestSchema);
    return previewNotifications(paths, filters);
  });
}
