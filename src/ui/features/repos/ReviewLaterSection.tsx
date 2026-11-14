/** Pull requests the user starred: refreshed on demand, with badges for what changed. */
import { useState } from 'react';
import { z } from 'zod';
import { ReviewLaterListSchema } from '../../../shared/api.ts';
import type { Repo } from '../../../shared/api.ts';
import { apiGet, apiSend } from '../../app/api.ts';
import { navigate } from '../../app/router.ts';
import { useAsync } from '../../app/useAsync.ts';
import { Button, IconButton } from '../../components/controls.tsx';
import { reviewLaterBadgeLabel, reviewLaterBadges } from '../pulls/badges.ts';
import styles from './HomePage.module.css';

type ReviewLaterSectionProps = { repos: readonly Repo[] };

export function ReviewLaterSection({ repos }: ReviewLaterSectionProps) {
  const list = useAsync('review-later', (signal) => apiGet('/api/review-later', ReviewLaterListSchema, signal));
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      await apiSend('POST', '/api/review-later/refresh', {}, ReviewLaterListSchema);
      list.reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not refresh the list');
    } finally {
      setRefreshing(false);
    }
  };

  const remove = async (repoId: string, number: number) => {
    setBusy(`${repoId}:${number}`);
    setError(null);
    try {
      await apiSend('DELETE', `/api/review-later/${repoId}/${number}`, undefined, z.undefined());
      list.reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not remove the entry');
    } finally {
      setBusy(null);
    }
  };

  const nameOf = (repoId: string): string => repos.find((repo) => repo.id === repoId)?.name ?? repoId;

  return (
    <section aria-labelledby="review-later-heading">
      <div className={styles.sectionHeader}>
        <h2 id="review-later-heading">Review later</h2>
        <span className={styles.spacer} />
        <Button icon="refresh" disabled={refreshing} aria-busy={refreshing} onClick={() => void refresh()}>
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>
      {(error ?? list.error) !== null && (
        <p className={styles.error} role="alert">
          {error ?? list.error}
        </p>
      )}
      {list.data?.length === 0 && (
        <p className={styles.empty}>
          Nothing saved yet. Star a pull request in a repository&apos;s Pull requests tab to keep it here.
        </p>
      )}
      <ul className={styles.list}>
        {list.data?.map((entry) => (
          <li key={`${entry.repoId}:${entry.number}`} className={styles.item}>
            <button
              type="button"
              className={styles.entryButton}
              onClick={() => navigate(`/repo/${entry.repoId}/pull/${entry.number}`)}
            >
              <span className={styles.entryRepo}>{nameOf(entry.repoId)}</span>
              <span className={styles.entryNumber}>#{entry.number}</span>
              <span className={styles.entryTitle}>{entry.title}</span>
            </button>
            <span className={styles.badges}>
              {reviewLaterBadges(entry).map((badge) => (
                <span
                  key={badge}
                  className={styles.badge}
                  data-kind={badge}
                  title={badge === 'error' ? entry.error : reviewLaterBadgeLabel(badge)}
                >
                  {reviewLaterBadgeLabel(badge)}
                </span>
              ))}
            </span>
            <IconButton
              icon="trash"
              label={`Remove #${entry.number} from Review later`}
              disabled={busy === `${entry.repoId}:${entry.number}`}
              onClick={() => void remove(entry.repoId, entry.number)}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
