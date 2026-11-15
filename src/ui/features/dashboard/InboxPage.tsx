/** The inbox as a page, so the dashboard's notification card can link to it. */
import { navigate } from '../../app/router.ts';
import { Brand } from '../../components/Brand.tsx';
import { Button } from '../../components/controls.tsx';
import { TopBarActions } from '../../components/TopBarActions.tsx';
import { relativeTime } from '../comments/threads.ts';
import { notificationTarget } from '../notifications/model.ts';
import { useNotifications } from '../notifications/useNotifications.ts';
import styles from './DashboardPage.module.css';

export function InboxPage() {
  // The top bar already runs the inbox poller; this page must not raise desktop notifications twice.
  const { items, unread, loading, checking, error, pollNow, markRead, markAll } = useNotifications(false);

  const open = (id: string, target: string): void => {
    void markRead([id]);
    navigate(target);
  };

  return (
    <div className={styles.page}>
      <header className={styles.topBar}>
        <Brand />
        <span className={styles.spacer} />
        <TopBarActions />
      </header>
      <main className={styles.body}>
        <div className={styles.sectionHeader}>
          <h1 className={styles.inboxTitle}>Inbox</h1>
          <span className={styles.count}>{unread} unread</span>
          <span className={styles.spacer} />
          <Button disabled={unread === 0} onClick={() => void markAll()}>
            Mark all read
          </Button>
          <Button icon="refresh" disabled={checking} aria-busy={checking} onClick={() => void pollNow()}>
            {checking ? 'Checking…' : 'Check now'}
          </Button>
        </div>

        {error !== null && (
          <p className={styles.error} role="alert">
            {error}{' '}
            <Button onClick={() => void pollNow()}>Retry</Button>
          </p>
        )}
        {loading && <p className={styles.empty}>Loading notifications…</p>}
        {!loading && items.length === 0 && error === null && (
          <p className={styles.empty}>No notifications yet. New comments on your pull requests appear here.</p>
        )}

        <ul className={styles.notifications}>
          {items.map((item) => (
            <li key={item.id} className={styles.notification} data-read={item.read}>
              <button
                type="button"
                className={styles.notificationRow}
                onClick={() => open(item.id, notificationTarget(item))}
              >
                <span className={styles.pullTitle}>{item.prTitle}</span>
                <span className={styles.pullMeta}>
                  {item.author} · #{item.number} · {relativeTime(item.createdAt)}
                </span>
                <span className={styles.excerpt}>{item.excerpt}</span>
              </button>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
