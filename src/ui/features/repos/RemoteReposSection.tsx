/** Remote repositories cloned by URL, plus the cached clones that can be deleted. */
import { useState } from 'react';
import { z } from 'zod';
import { CloneInfoListSchema, FetchResponseSchema, RepoSchema } from '../../../shared/api.ts';
import type { Repo } from '../../../shared/api.ts';
import { apiGet, apiSend } from '../../app/api.ts';
import { navigate } from '../../app/router.ts';
import { useAsync } from '../../app/useAsync.ts';
import { Button, IconButton } from '../../components/controls.tsx';
import styles from './HomePage.module.css';

type RemoteReposSectionProps = {
  repos: readonly Repo[];
  onReposChanged: () => void;
};

export function RemoteReposSection({ repos, onReposChanged }: RemoteReposSectionProps) {
  const remoteRepos = repos.filter((repo) => repo.kind === 'remote');
  const clones = useAsync('clones', (signal) => apiGet('/api/clones', CloneInfoListSchema, signal));
  const [url, setUrl] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fetched, setFetched] = useState<string | null>(null);

  const run = async (action: () => Promise<void>) => {
    setBusy('global');
    setError(null);
    try {
      await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Something went wrong');
    } finally {
      setBusy(null);
    }
  };

  const connect = () =>
    run(async () => {
      setConnecting(true);
      try {
        const repo = await apiSend('POST', '/api/repos/remote', { url }, RepoSchema);
        setUrl('');
        onReposChanged();
        navigate(`/repo/${repo.id}/pulls`);
      } finally {
        setConnecting(false);
      }
    });

  const fetch = (repo: Repo) =>
    run(async () => {
      setBusy(repo.id);
      try {
        await apiSend('POST', `/api/repos/${repo.id}/fetch`, {}, FetchResponseSchema);
        setFetched(repo.id);
        onReposChanged();
      } finally {
        setBusy(null);
      }
    });

  const remove = (repo: Repo) =>
    run(async () => {
      setBusy(repo.id);
      try {
        await apiSend('DELETE', `/api/repos/${repo.id}`, undefined, z.undefined());
        onReposChanged();
      } finally {
        setBusy(null);
      }
    });

  const removeClone = (repoId: string) =>
    run(async () => {
      setBusy(repoId);
      try {
        await apiSend('DELETE', `/api/clones/${repoId}`, undefined, z.undefined());
        clones.reload();
        onReposChanged();
      } finally {
        setBusy(null);
      }
    });

  return (
    <section aria-labelledby="remote-heading">
      <h2 id="remote-heading">Remote repositories</h2>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          void connect();
        }}
      >
        <input
          className={styles.pathInput}
          aria-label="Repository URL"
          placeholder="https://github.com/owner/repo or https://gitlab.com/group/repo"
          value={url}
          spellCheck={false}
          onChange={(event) => setUrl(event.target.value)}
        />
        <Button type="submit" variant="primary" disabled={busy !== null || url.trim() === ''}>
          {connecting ? 'Cloning…' : 'Connect'}
        </Button>
      </form>
      {error !== null && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {remoteRepos.length === 0 && (
        <p className={styles.empty}>
          No remote repository yet. Paste a GitHub or GitLab URL above to review its pull requests without a checkout.
        </p>
      )}
      <ul className={styles.list}>
        {remoteRepos.map((repo) => (
          <li key={repo.id} className={styles.item}>
            <a
              className={styles.repoLink}
              href={`/repo/${repo.id}/pulls`}
              onClick={(event) => {
                event.preventDefault();
                navigate(`/repo/${repo.id}/pulls`);
              }}
            >
              <strong>{repo.name}</strong>
              <span className={styles.path}>{repo.remote?.host}/{repo.remote?.project}</span>
            </a>
            {fetched === repo.id && <span className={styles.hint}>Fetched</span>}
            <Button icon="refresh" disabled={busy !== null} aria-busy={busy === repo.id} onClick={() => void fetch(repo)}>
              Fetch
            </Button>
            <IconButton
              icon="trash"
              label={`Remove ${repo.name}`}
              disabled={busy !== null}
              onClick={() => void remove(repo)}
            />
          </li>
        ))}
      </ul>

      <details className={styles.clones}>
        <summary>Cached clones</summary>
        <p className={styles.hint}>Clones keep pull request objects local. Deleting one frees disk space.</p>
        {clones.error !== null && <p className={styles.error}>{clones.error}</p>}
        {clones.data?.length === 0 && <p className={styles.empty}>No cached clones.</p>}
        <ul className={styles.list}>
          {clones.data?.map((clone) => (
            <li key={clone.repoId} className={styles.item}>
              <span className={styles.repoLink}>
                <strong>{clone.project}</strong>
                <span className={styles.path}>{clone.host}</span>
              </span>
              <span className={styles.meta}>{formatBytes(clone.sizeBytes)}</span>
              <span className={styles.meta}>used {formatDate(clone.lastUsedAt)}</span>
              <IconButton
                icon="trash"
                label={`Delete cached clone ${clone.project}`}
                disabled={busy !== null}
                onClick={() => void removeClone(clone.repoId)}
              />
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit] ?? 'B'}`;
}

function formatDate(iso: string): string {
  const time = Date.parse(iso);
  return Number.isNaN(time) ? iso : new Date(time).toLocaleDateString();
}
