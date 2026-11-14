/** The actions every top bar shares: the notification bell and the settings gear. */
import { navigate } from '../app/router.ts';
import { Bell } from '../features/notifications/Bell.tsx';
import styles from './TopBarActions.module.css';

export function TopBarActions() {
  return (
    <div className={styles.actions}>
      <Bell />
      <button
        type="button"
        className={styles.iconButton}
        aria-label="Settings"
        title="Settings"
        onClick={() => navigate('/settings')}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="8" cy="8" r="2.3" />
          <path d="M8 1.5v1.7M8 12.8v1.7M1.5 8h1.7M12.8 8h1.7M3.4 3.4l1.2 1.2M11.4 11.4l1.2 1.2M3.4 12.6l1.2-1.2M11.4 4.6l1.2-1.2" />
        </svg>
      </button>
    </div>
  );
}
