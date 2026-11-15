/**
 * The review's single status line: the autosave state for the reader, and the last refresh time in
 * its tooltip. Keeping the refresh time here removes the second "Updated …" text from the toolbar.
 */
import type { SaveStatus as SaveState } from '../comments/types.ts';
import styles from './ReviewPage.module.css';

type SaveStatusProps = {
  status: SaveState;
  /** Pre-formatted age, e.g. "2 min ago"; `null` before the first successful load. */
  refreshedAgo: string | null;
  onRetry: () => void;
};

export function SaveStatus({ status, refreshedAgo, onRetry }: SaveStatusProps) {
  const title = refreshedAgo === null ? undefined : `Last refreshed ${refreshedAgo}`;

  if (status === 'error') {
    return (
      <button type="button" className={styles.saveError} data-save-status={status} title={title} onClick={onRetry}>
        Not saved — retry
      </button>
    );
  }
  return (
    <span className={styles.saveStatus} data-status={status} data-save-status={status} title={title} aria-live="polite">
      {status === 'saving' ? 'Saving…' : 'Saved'}
    </span>
  );
}
