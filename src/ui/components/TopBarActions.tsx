/** The actions every top bar shares: the repositories page, the notification bell and the global settings. */
import { navigate } from '../app/router.ts';
import { Bell } from '../features/notifications/Bell.tsx';
import { Icon } from './Icon.tsx';
import styles from './TopBarActions.module.css';

export function TopBarActions() {
  return (
    <div className={styles.actions}>
      <button
        type="button"
        className={styles.navButton}
        title="Connected repositories and how each one connects"
        onClick={() => navigate('/repositories')}
      >
        <Icon name="folder" />
        <span className={styles.label}>Repositories</span>
      </button>
      <Bell />
      <button
        type="button"
        className={styles.navButton}
        title="Settings that apply everywhere: appearance, review defaults, notifications, tokens"
        onClick={() => navigate('/settings')}
      >
        <Icon name="gear" />
        <span className={styles.label}>Settings</span>
      </button>
    </div>
  );
}
