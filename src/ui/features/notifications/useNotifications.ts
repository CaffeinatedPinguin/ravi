/** Polling, read state and desktop notifications for the inbox. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { NotificationListSchema } from '../../../shared/api.ts';
import type { Notification, NotificationList } from '../../../shared/api.ts';
import { apiGet, apiSend } from '../../app/api.ts';
import { errorMessage } from '../../app/errors.ts';
import { navigate } from '../../app/router.ts';
import { desktopNotification, notificationTarget, notificationsToShow, rememberShown } from './model.ts';

/** The inbox refreshes on its own once a minute; the server's poller uses the configured interval. */
const INBOX_POLL_MS = 60_000;

export type NotificationsState = {
  items: Notification[];
  unread: number;
  loading: boolean;
  checking: boolean;
  error: string | null;
  pollNow: () => Promise<void>;
  markRead: (ids: string[]) => Promise<void>;
  markAll: () => Promise<void>;
};

export function useNotifications(desktopEnabled: boolean): NotificationsState {
  const [list, setList] = useState<NotificationList>({ items: [], unread: 0 });
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** `null` until the first answer: that answer is the baseline, not a burst of notifications. */
  const previousIds = useRef<Set<string> | null>(null);
  const shown = useRef(new Set<string>());

  const apply = useCallback(
    (next: NotificationList) => {
      const previous = previousIds.current;
      previousIds.current = new Set(next.items.map((item) => item.id));
      setList(next);
      if (!desktopEnabled) {
        return;
      }
      const fresh = notificationsToShow(previous, next.items, shown.current);
      if (fresh.length === 0) {
        return;
      }
      rememberShown(shown.current, fresh.map((item) => item.id));
      for (const item of fresh) {
        showDesktop(item);
      }
    },
    [desktopEnabled],
  );

  const load = useCallback(async () => {
    try {
      apply(await apiGet('/api/notifications', NotificationListSchema));
      setError(null);
    } catch (reason) {
      setError(errorMessage(reason, 'Could not load notifications'));
    } finally {
      setLoading(false);
    }
  }, [apply]);

  useEffect(() => {
    // Deferred so the first request is not a synchronous state update inside the effect.
    const start = window.setTimeout(() => {
      if (document.visibilityState !== 'hidden') {
        void load();
      }
    }, 0);
    const tick = () => {
      // A hidden tab must not spend forge calls or battery; focus/visibility brings it back.
      if (document.visibilityState !== 'hidden') {
        void load();
      }
    };
    const timer = window.setInterval(tick, INBOX_POLL_MS);
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearTimeout(start);
      window.clearInterval(timer);
      window.removeEventListener('focus', tick);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [load]);

  const pollNow = useCallback(async () => {
    setChecking(true);
    try {
      apply(await apiSend('POST', '/api/notifications/poll', {}, NotificationListSchema));
      setError(null);
    } catch (reason) {
      setError(errorMessage(reason, 'Could not load notifications'));
    } finally {
      setChecking(false);
    }
  }, [apply]);

  const markRead = useCallback(async (ids: string[]) => {
    try {
      // The answer is a full inbox; a comment that arrived meanwhile is treated like any poll.
      apply(await apiSend('POST', '/api/notifications/read', { ids }, NotificationListSchema));
    } catch (reason) {
      setError(errorMessage(reason, 'Could not load notifications'));
    }
  }, [apply]);

  const markAll = useCallback(async () => {
    try {
      apply(await apiSend('POST', '/api/notifications/read', { all: true }, NotificationListSchema));
    } catch (reason) {
      setError(errorMessage(reason, 'Could not load notifications'));
    }
  }, [apply]);

  return { ...list, loading, checking, error, pollNow, markRead, markAll };
}

/** The browser refuses notifications without a granted permission; never ask from here. */
function showDesktop(item: Notification): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
    return;
  }
  const message = desktopNotification(item);
  const notification = new Notification(message.title, { body: message.body, tag: message.tag });
  notification.onclick = () => {
    window.focus();
    navigate(notificationTarget(item));
    notification.close();
  };
}
