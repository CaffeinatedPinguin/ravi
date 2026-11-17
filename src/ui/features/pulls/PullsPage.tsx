/** Pull requests of one repository: filters, fetch, review-later stars and the way into a review. */
import { useState } from 'react';
import { z } from 'zod';
import { FetchResponseSchema, RepoListSchema, ReviewLaterListSchema } from '../../../shared/api.ts';
import { apiGet, apiSend } from '../../app/api.ts';
import { errorMessage } from '../../app/errors.ts';
import { navigate } from '../../app/router.ts';
import { useSettings } from '../../app/settings.tsx';
import { useAsync } from '../../app/useAsync.ts';
import { Brand } from '../../components/Brand.tsx';
import { Button, IconButton, Segmented, Toggle } from '../../components/controls.tsx';
import { TopBarActions } from '../../components/TopBarActions.tsx';
import { relativeTime } from '../comments/threads.ts';
import { RepoNav } from '../repos/RepoNav.tsx';
import page from '../review/ReviewPage.module.css';
import styles from './PullsPage.module.css';
import { PullRequestListSchema } from './schemas.ts';

type PullsPageProps = { repoId: string };

export function PullsPage({ repoId }: PullsPageProps) {
  const { settings, update } = useSettings();
  const repos = useAsync('repos', (signal) => apiGet('/api/repos', RepoListSchema, signal));
  const [state, setState] = useState<'open' | 'all'>('open');
  const [mine, setMine] = useState(false);
  const pulls = useAsync(`pulls:${repoId}:${state}:${mine ? '1' : '0'}`, (signal) =>
    apiGet(`/api/repos/${repoId}/pulls?state=${state}&mine=${mine ? '1' : '0'}`, PullRequestListSchema, signal),
  );
  const later = useAsync('review-later', (signal) => apiGet('/api/review-later', ReviewLaterListSchema, signal));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const repo = repos.data?.find((candidate) => candidate.id === repoId);
  const starred = new Set((later.data ?? []).map((entry) => `${entry.repoId}:${entry.number}`));

  const toggleStar = async (number: number) => {
    setBusy(`${repoId}:${number}`);
    setError(null);
    try {
      if (starred.has(`${repoId}:${number}`)) {
        await apiSend('DELETE', `/api/review-later/${repoId}/${number}`, undefined, z.undefined());
      } else {
        await apiSend('POST', '/api/review-later', { repoId, number }, z.unknown());
      }
      later.reload();
    } catch (reason) {
      setError(errorMessage(reason, 'Could not update Review later'));
    } finally {
      setBusy(null);
    }
  };

  const fetch = async () => {
    setBusy('fetch');
    setError(null);
    try {
      await apiSend('POST', `/api/repos/${repoId}/fetch`, {}, FetchResponseSchema);
      pulls.reload();
    } catch (reason) {
      setError(errorMessage(reason, 'Could not fetch the repository'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={page.page}>
      <header className={page.topBar}>
        <Brand />
        <RepoNav repoId={repoId} active="pulls" showLocal={repo?.kind !== 'remote'} />
        <span className={styles.repoName}>{repo?.name ?? repoId}</span>
        {repo?.remote !== null && repo?.remote !== undefined && (
          <span className={page.branch}>
            {repo.remote.host}/{repo.remote.project}
          </span>
        )}
        <span className={page.spacer} />
        <IconButton
          icon={settings.theme === 'dark' || (settings.theme === 'system' && document.documentElement.dataset.theme === 'dark') ? 'sun' : 'moon'}
          label="Switch between light and dark theme"
          onClick={() => update({ theme: document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark' })}
        />
        <TopBarActions />
      </header>

      <div className={page.toolbar}>
        <Segmented
          label="Pull request state"
          value={state}
          options={[
            { value: 'open', label: 'Open' },
            { value: 'all', label: 'All' },
          ]}
          onChange={setState}
        />
        <Toggle checked={mine} onChange={setMine}>
          Mine
        </Toggle>
        <span className={page.spacer} />
        <span className={page.updated} aria-live="polite">
          {pulls.data ? `${pulls.data.length} pull ${pulls.data.length === 1 ? 'request' : 'requests'}` : ''}
        </span>
        {repo?.kind === 'remote' && (
          <Button icon="refresh" disabled={busy !== null} aria-busy={busy === 'fetch'} onClick={() => void fetch()}>
            {busy === 'fetch' ? 'Fetching…' : 'Fetch'}
          </Button>
        )}
        <IconButton
          icon="refresh"
          label="Reload pull requests"
          aria-busy={pulls.loading}
          className={pulls.loading ? page.refreshing : undefined}
          onClick={pulls.reload}
        />
      </div>

      <main className={styles.body}>
        {error !== null && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        {pulls.error !== null && (
          <div className={styles.message} role="alert">
            <p>{pulls.error}</p>
            <Button onClick={pulls.reload}>Try again</Button>
          </div>
        )}
        {pulls.error === null && pulls.loading && pulls.data === undefined && (
          <p className={styles.message}>Loading pull requests…</p>
        )}
        {pulls.data?.length === 0 && (
          <p className={styles.message}>
            {state === 'open'
              ? 'No open pull requests. Switch to All to see closed and merged ones.'
              : 'No pull requests for this repository.'}
          </p>
        )}
        {pulls.data !== undefined && pulls.data.length > 0 && (
          <ul className={styles.list}>
            {pulls.data.map((pull) => {
              const key = `${repoId}:${pull.number}`;
              return (
                <li key={pull.number} className={styles.item}>
                  <button
                    type="button"
                    className={styles.row}
                    onClick={() => navigate(`/repo/${repoId}/pull/${pull.number}`)}
                  >
                    <span className={styles.number}>#{pull.number}</span>
                    <span className={styles.title}>{pull.title}</span>
                    <span className={styles.meta}>{pull.author}</span>
                    <span className={styles.meta}>{relativeTime(pull.updatedAt)}</span>
                    <span className={styles.state} data-state={pull.state}>
                      {pull.draft ? 'draft' : pull.state}
                    </span>
                  </button>
                  <IconButton
                    icon="star"
                    label={starred.has(key) ? `Remove #${pull.number} from Review later` : `Add #${pull.number} to Review later`}
                    aria-pressed={starred.has(key)}
                    className={starred.has(key) ? styles.starred : undefined}
                    disabled={busy !== null}
                    onClick={() => void toggleStar(pull.number)}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
