/** The bell in every top bar: unread badge and the inbox panel. */
import { useEffect, useRef, useState } from 'react';
import type { Notification } from '../../../shared/api.ts';
import { navigate } from '../../app/router.ts';
import { useSettings } from '../../app/settings.tsx';
import { relativeTime } from '../comments/threads.ts';
import styles from './Notifications.module.css';
import { notificationTarget } from './model.ts';
import { useNotifications } from './useNotifications.ts';

export function Bell() {
  const { settings } = useSettings();
  const { items, unread, loading, checking, error, pollNow, markRead, markAll } = useNotifications(
    settings.notifications.enabled,
  );
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  // Dismiss on Escape or a click outside, like a menu; focus stays usable with the keyboard.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointer = (event: MouseEvent) => {
      if (root.current !== null && !root.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const openItem = (item: Notification) => {
    setOpen(false);
    void markRead([item.id]);
    navigate(notificationTarget(item));
  };

  return (
    <div className={styles.bellWrap} ref={root}>
      <button
        type="button"
        className={styles.iconButton}
        aria-label={`Notifications, ${unread} unread`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4.5 6.5a3.5 3.5 0 0 1 7 0c0 3 1.5 4 1.5 4h-10s1.5-1 1.5-4zM6.5 13a1.5 1.5 0 0 0 3 0" />
        </svg>
        {unread > 0 && (
          <span className={styles.badge} aria-hidden="true">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <section className={styles.panel} role="dialog" aria-label="Notifications">
          <header className={styles.panelHeader}>
            <strong>Inbox</strong>
            <span className={styles.unreadCount}>{unread} unread</span>
            <span className={styles.spacer} />
            <button type="button" className={styles.linkButton} disabled={unread === 0} onClick={() => void markAll()}>
              Mark all read
            </button>
            <button type="button" className={styles.linkButton} disabled={checking} onClick={() => void pollNow()}>
              {checking ? 'Checking…' : 'Check now'}
            </button>
          </header>

          {error !== null && (
            <p className={styles.panelError} role="alert">
              {error}{' '}
              <button type="button" className={styles.linkButton} onClick={() => void pollNow()}>
                Retry
              </button>
            </p>
          )}
          {loading && <p className={styles.muted}>Loading notifications…</p>}
          {!loading && items.length === 0 && error === null && (
            <p className={styles.muted}>No notifications yet. New comments on your pull requests appear here.</p>
          )}

          <ul className={styles.items}>
            {items.map((item) => (
              <li key={item.id}>
                <button type="button" className={styles.item} data-read={item.read} onClick={() => openItem(item)}>
                  <span className={styles.itemTop}>
                    <span className={styles.author}>{item.author}</span>
                    <span className={styles.number}>#{item.number}</span>
                    <span className={styles.spacer} />
                    <time className={styles.time} dateTime={item.createdAt}>
                      {relativeTime(item.createdAt)}
                    </time>
                  </span>
                  <span className={styles.prTitle}>{item.prTitle}</span>
                  <span className={styles.excerpt}>{item.excerpt}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
