/**
 * The first screen after the app opens: setup when nothing is connected, otherwise one section per
 * repository with its working tree and pull requests. Each repository loads on its own (max four at a
 * time), so a slow forge never blocks the rest of the page.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { z } from 'zod';
import { NotificationListSchema, RepoListSchema, ReviewLaterListSchema } from '../../../shared/api.ts';
import type { Repo, ReviewLaterEntry } from '../../../shared/api.ts';
import type { ForgeStatus, PullRequestSummary } from '../../../shared/forge.ts';
import { apiGet, apiSend } from '../../app/api.ts';
import { navigate } from '../../app/router.ts';
import { useAsync } from '../../app/useAsync.ts';
import { Brand } from '../../components/Brand.tsx';
import { Button, IconButton } from '../../components/controls.tsx';
import { TopBarActions } from '../../components/TopBarActions.tsx';
import { relativeTime } from '../comments/threads.ts';
import { notificationTarget } from '../notifications/model.ts';
import { ForgeStatusListSchema } from '../pulls/schemas.ts';
import { filterRepos, groupPullRequests, repoTarget, startView } from './dashboard.ts';
import type { RepoCard } from './useRepoCards.ts';
import { useRepoCards } from './useRepoCards.ts';
import styles from './DashboardPage.module.css';
import { SetupScreen } from './SetupScreen.tsx';

export function DashboardPage() {
  const repos = useAsync('repos', (signal) => apiGet('/api/repos', RepoListSchema, signal));

  if (repos.error !== null) {
    return (
      <Frame>
        <div className={styles.message} role="alert">
          <p>{repos.error}</p>
          <Button onClick={repos.reload}>Try again</Button>
        </div>
      </Frame>
    );
  }
  if (repos.data === undefined) {
    return (
      <Frame>
        <p className={styles.message}>Loading repositories…</p>
      </Frame>
    );
  }
  return startView(repos.data) === 'setup' ? <SetupScreen /> : <DashboardView repos={repos.data} />;
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className={styles.page}>
      <header className={styles.topBar}>
        <Brand />
        <span className={styles.spacer} />
        <TopBarActions />
      </header>
      <main className={styles.body}>{children}</main>
    </div>
  );
}

function DashboardView({ repos }: { repos: readonly Repo[] }) {
  const forges = useAsync('forges', (signal) => apiGet('/api/forges', ForgeStatusListSchema, signal));
  const later = useAsync('review-later', (signal) => apiGet('/api/review-later', ReviewLaterListSchema, signal));
  const [refreshKey, setRefreshKey] = useState(0);
  const [starBusy, setStarBusy] = useState<string | null>(null);
  const [starError, setStarError] = useState<string | null>(null);
  const [laterRefreshing, setLaterRefreshing] = useState(false);

  const pullEnabled = useMemo(() => {
    const tokenByHost = new Map((forges.data ?? []).map((forge) => [forge.host, forge.hasToken]));
    const ids = new Set<string>();
    for (const repo of repos) {
      if (repo.remote !== null && tokenByHost.get(repo.remote.host) === true) {
        ids.add(repo.id);
      }
    }
    return ids;
  }, [repos, forges.data]);

  const { cards, reload } = useRepoCards(repos, pullEnabled, refreshKey);
  const starred = useMemo(
    () => new Set((later.data ?? []).map((entry) => `${entry.repoId}:${entry.number}`)),
    [later.data],
  );

  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const search = useRef<HTMLInputElement>(null);
  const filtered = useMemo(() => filterRepos(repos, query), [repos, query]);

  const move = useCallback(
    (delta: number) => {
      setActive((current) => {
        if (filtered.length === 0) {
          return -1;
        }
        return Math.min(Math.max(current + delta, 0), filtered.length - 1);
      });
    },
    [filtered.length],
  );

  // `/` focuses search; arrows move the repository highlight; Enter opens the highlighted one.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      const target = event.target instanceof HTMLElement ? event.target : null;
      const inField = target !== null && target.closest('input, textarea, select, [contenteditable="true"]') !== null;
      if (event.key === '/' && !inField) {
        event.preventDefault();
        search.current?.focus();
        search.current?.select();
      } else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && (!inField || target === search.current)) {
        event.preventDefault();
        move(event.key === 'ArrowDown' ? 1 : -1);
      } else if (event.key === 'Enter' && active >= 0 && (!inField || target === search.current)) {
        const repo = filtered[active];
        if (repo !== undefined) {
          event.preventDefault();
          navigate(repoTarget(repo));
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, filtered, move]);

  const toggleStar = async (repoId: string, number: number): Promise<void> => {
    const key = `${repoId}:${number}`;
    setStarBusy(key);
    setStarError(null);
    try {
      if (starred.has(key)) {
        await apiSend('DELETE', `/api/review-later/${repoId}/${number}`, undefined, z.undefined());
      } else {
        await apiSend('POST', '/api/review-later', { repoId, number }, z.unknown());
      }
      later.reload();
    } catch (reason) {
      setStarError(reason instanceof Error ? reason.message : 'Could not update Review later');
    } finally {
      setStarBusy(null);
    }
  };

  const refreshLater = async (): Promise<void> => {
    setLaterRefreshing(true);
    setStarError(null);
    try {
      await apiSend('POST', '/api/review-later/refresh', {}, ReviewLaterListSchema);
      later.reload();
    } catch (reason) {
      setStarError(reason instanceof Error ? reason.message : 'Could not refresh Review later');
    } finally {
      setLaterRefreshing(false);
    }
  };

  const loading = Object.values(cards).some((card) => card.loading);

  return (
    <div className={styles.page}>
      <header className={styles.topBar}>
        <Brand />
        <input
          ref={search}
          className={styles.search}
          type="search"
          aria-label="Search repositories"
          placeholder="/ to search repositories"
          value={query}
          spellCheck={false}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(-1);
          }}
        />
        <span className={styles.spacer} />
        <Button
          icon="refresh"
          title="Reload every repository and the Review later list"
          aria-busy={loading || laterRefreshing}
          onClick={() => {
            setRefreshKey((value) => value + 1);
            void refreshLater();
          }}
        >
          Refresh all
        </Button>
        <TopBarActions />
      </header>

      <main className={styles.body}>
        <h1 className={styles.srOnly}>ravi</h1>
        {starError !== null && (
          <p className={styles.error} role="alert">
            {starError}
          </p>
        )}

        <div className={styles.topRow}>
          <ReviewLaterPanel
            entries={later.data}
            error={later.error}
            repos={repos}
          />
          <NotificationsCard />
        </div>

        {filtered.length === 0 ? (
          <p className={styles.message}>No repository matches “{query}”.</p>
        ) : (
          <div className={styles.repos} role="list" aria-label="Repositories">
            {filtered.map((repo, index) => (
              <div role="listitem" key={repo.id}>
                <RepositorySection
                  repo={repo}
                  card={cards[repo.id]}
                  forges={forges.data}
                  active={index === active}
                  starred={starred}
                  starBusy={starBusy}
                  onToggleStar={(number) => void toggleStar(repo.id, number)}
                  onReload={() => reload(repo)}
                />
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

type RepositorySectionProps = {
  repo: Repo;
  card: RepoCard | undefined;
  forges: ForgeStatus[] | undefined;
  active: boolean;
  starred: ReadonlySet<string>;
  starBusy: string | null;
  onToggleStar: (number: number) => void;
  onReload: () => void;
};

function RepositorySection({
  repo,
  card,
  forges,
  active,
  starred,
  starBusy,
  onToggleStar,
  onReload,
}: RepositorySectionProps) {
  const status = forgeStatusOf(repo, forges);
  const groups = groupPullRequests(card?.pulls ?? []);
  const uncommitted = card?.summary?.uncommitted;
  const key = `${repo.id}`;

  return (
    <section className={styles.repo} data-active={active || undefined} aria-labelledby={`${key}-title`}>
      <header className={styles.repoHeader}>
        <h2 id={`${key}-title`} className={styles.repoName}>
          <a
            href={repoTarget(repo)}
            onClick={(event) => {
              event.preventDefault();
              navigate(repoTarget(repo));
            }}
          >
            {repo.name}
          </a>
        </h2>
        <code className={styles.path} title={repo.path}>
          {repo.remote === null ? repo.path : `${repo.remote.host}/${repo.remote.project}`}
        </code>
        <span className={styles.spacer} />
        {card?.summary?.branch !== null && card?.summary?.branch !== undefined && (
          <span className={styles.pill}>{card.summary.branch}</span>
        )}
        {card?.summary?.ahead !== null && card?.summary?.ahead !== undefined && (
          <span className={styles.pill} title="Commits ahead / behind the upstream">
            ↑{card.summary.ahead} ↓{card.summary.behind ?? 0}
          </span>
        )}
        <span className={styles.connection} data-missing={status.missing || undefined}>
          {status.label}
        </span>
        <IconButton icon="refresh" label={`Refresh ${repo.name}`} aria-busy={card?.loading} onClick={onReload} />
      </header>

      {card?.error !== null && card?.error !== undefined && (
        <div className={styles.repoError} role="alert">
          <span>{card.error}</span>
          <Button onClick={onReload}>Try again</Button>
        </div>
      )}
      {card?.loading === true && card.pulls.length === 0 && card.summary === null && (
        <div className={styles.skeleton} role="status" aria-label="Loading repository">
          <span />
          <span />
        </div>
      )}

      {uncommitted !== null && uncommitted !== undefined && (
        <p className={styles.changesLine}>
          <a
            className={styles.changes}
            href={`/repo/${repo.id}`}
            onClick={(event) => {
              event.preventDefault();
              navigate(`/repo/${repo.id}`);
            }}
          >
            {uncommitted.files} {uncommitted.files === 1 ? 'file' : 'files'} ·{' '}
            <span className={styles.add}>+{uncommitted.additions}</span>{' '}
            <span className={styles.del}>−{uncommitted.deletions}</span>
            {uncommitted.untracked > 0 && <> · {uncommitted.untracked} untracked</>}
          </a>
          {card?.summary?.lastCommit !== null && card?.summary?.lastCommit !== undefined && (
            <span className={styles.lastCommit} title={card.summary.lastCommit.sha}>
              Last commit: {card.summary.lastCommit.subject} ·{' '}
              <time dateTime={card.summary.lastCommit.date}>{relativeTime(card.summary.lastCommit.date)}</time>
            </span>
          )}
        </p>
      )}

      {card?.summary === null &&
        card?.loading !== true &&
        (card?.error === null || card?.error === undefined) && (
          <p className={styles.empty}>Remote clone: no working tree. Open its pull requests above.</p>
        )}

      <PullGroups
        repoId={repo.id}
        groups={groups}
        emptyMessage={emptyMessage(repo, status, card)}
        starred={starred}
        starBusy={starBusy}
        onToggleStar={onToggleStar}
      />
    </section>
  );
}

type PullGroupsProps = {
  repoId: string;
  groups: ReturnType<typeof groupPullRequests>;
  emptyMessage: ReactNode;
  starred: ReadonlySet<string>;
  starBusy: string | null;
  onToggleStar: (number: number) => void;
};

function PullGroups({ repoId, groups, emptyMessage, starred, starBusy, onToggleStar }: PullGroupsProps) {
  const total = groups.reviewRequested.length + groups.mine.length + groups.other.length;
  if (total === 0) {
    return emptyMessage === null ? null : <p className={styles.empty}>{emptyMessage}</p>;
  }
  return (
    <div className={styles.groups}>
      <PullGroup
        title="Waiting for my review"
        pulls={groups.reviewRequested}
        repoId={repoId}
        starred={starred}
        starBusy={starBusy}
        onToggleStar={onToggleStar}
      />
      <PullGroup
        title="Mine"
        pulls={groups.mine}
        repoId={repoId}
        starred={starred}
        starBusy={starBusy}
        onToggleStar={onToggleStar}
      />
      <PullGroup
        title="Other open"
        pulls={groups.other}
        repoId={repoId}
        starred={starred}
        starBusy={starBusy}
        onToggleStar={onToggleStar}
      />
    </div>
  );
}

type PullGroupProps = {
  title: string;
  pulls: readonly PullRequestSummary[];
  repoId: string;
  starred: ReadonlySet<string>;
  starBusy: string | null;
  onToggleStar: (number: number) => void;
};

function PullGroup({ title, pulls, repoId, starred, starBusy, onToggleStar }: PullGroupProps) {
  if (pulls.length === 0) {
    return null;
  }
  const list = <PullList pulls={pulls} repoId={repoId} starred={starred} starBusy={starBusy} onToggleStar={onToggleStar} />;
  const heading = (
    <>
      {title} <span className={styles.count}>{pulls.length}</span>
    </>
  );
  // A long group stays collapsed so one noisy repository cannot push the next one off screen.
  return pulls.length > 5 ? (
    <details className={styles.group}>
      <summary className={styles.groupSummary}>{heading}</summary>
      {list}
    </details>
  ) : (
    <section className={styles.group}>
      <h3 className={styles.groupTitle}>{heading}</h3>
      {list}
    </section>
  );
}

function PullList({
  pulls,
  repoId,
  starred,
  starBusy,
  onToggleStar,
}: {
  pulls: readonly PullRequestSummary[];
  repoId: string;
  starred: ReadonlySet<string>;
  starBusy: string | null;
  onToggleStar: (number: number) => void;
}) {
  return (
    <ul className={styles.pulls}>
      {pulls.map((pull) => {
        const key = `${repoId}:${pull.number}`;
        const isStarred = starred.has(key);
        return (
          <li key={pull.number} className={styles.pull}>
            <button
              type="button"
              className={styles.pullRow}
              onClick={() => navigate(`/repo/${repoId}/pull/${pull.number}`)}
            >
              <span className={styles.pullNumber}>#{pull.number}</span>
              <span className={styles.pullTitle}>{pull.title}</span>
              <span className={styles.pullMeta}>
                {pull.author} · {relativeTime(pull.updatedAt)}
              </span>
            </button>
            <IconButton
              icon="star"
              label={isStarred ? `Remove #${pull.number} from Review later` : `Add #${pull.number} to Review later`}
              aria-pressed={isStarred}
              className={isStarred ? styles.starred : undefined}
              disabled={starBusy === key}
              onClick={() => onToggleStar(pull.number)}
            />
          </li>
        );
      })}
    </ul>
  );
}

type ReviewLaterPanelProps = {
  entries: ReviewLaterEntry[] | undefined;
  error: string | null;
  repos: readonly Repo[];
};

function ReviewLaterPanel({ entries, error, repos }: ReviewLaterPanelProps) {
  const nameOf = (repoId: string): string => repos.find((repo) => repo.id === repoId)?.name ?? repoId;
  return (
    <section className={styles.panel} aria-labelledby="dashboard-review-later">
      <div className={styles.sectionHeader}>
        <h2 id="dashboard-review-later">Review later</h2>
        <span className={styles.count}>{entries?.length ?? 0}</span>
      </div>
      {error !== null && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {entries?.length === 0 && (
        <p className={styles.empty}>Nothing saved yet. Star a pull request in a repository&apos;s list to keep it here.</p>
      )}
      <ul className={styles.notifications}>
        {entries?.slice(0, 5).map((entry) => (
          <li key={`${entry.repoId}:${entry.number}`}>
            <button
              type="button"
              className={styles.notificationRow}
              onClick={() => navigate(`/repo/${entry.repoId}/pull/${entry.number}`)}
            >
              <span className={styles.pullTitle}>{entry.title}</span>
              <span className={styles.pullMeta}>
                {nameOf(entry.repoId)} · #{entry.number}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function NotificationsCard() {
  const list = useAsync('notifications', (signal) => apiGet('/api/notifications', NotificationListSchema, signal));
  const unread = list.data?.items.filter((item) => !item.read).slice(0, 4) ?? [];

  return (
    <section className={styles.panel} aria-labelledby="dashboard-notifications">
      <div className={styles.sectionHeader}>
        <h2 id="dashboard-notifications">Notifications</h2>
        <span className={styles.count}>{list.data?.unread ?? 0} unread</span>
        <span className={styles.spacer} />
        <a
          href="/inbox"
          onClick={(event) => {
            event.preventDefault();
            navigate('/inbox');
          }}
        >
          Open inbox
        </a>
      </div>
      {list.error !== null && (
        <p className={styles.error} role="alert">
          {list.error}{' '}
          <Button onClick={list.reload}>Retry</Button>
        </p>
      )}
      {list.data !== undefined && unread.length === 0 && <p className={styles.empty}>You are all caught up.</p>}
      <ul className={styles.notifications}>
        {unread.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className={styles.notificationRow}
              onClick={() => navigate(notificationTarget(item))}
            >
              <span className={styles.pullTitle}>{item.prTitle}</span>
              <span className={styles.pullMeta}>
                {item.author} · #{item.number} · {relativeTime(item.createdAt)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function forgeStatusOf(repo: Repo, forges: ForgeStatus[] | undefined): { label: string; missing: boolean } {
  if (repo.remote === null) {
    return { label: 'Local folder', missing: false };
  }
  const status = forges?.find((forge) => forge.host === repo.remote?.host);
  if (status === undefined) {
    return { label: `${repo.remote.host} · checking token`, missing: false };
  }
  return status.hasToken
    ? { label: `${repo.remote.host} · token present`, missing: false }
    : { label: `${repo.remote.host} · token missing`, missing: true };
}

function emptyMessage(repo: Repo, status: { missing: boolean }, card: RepoCard | undefined): ReactNode {
  if (card?.error !== null && card?.error !== undefined) {
    return null;
  }
  if (repo.remote === null) {
    return 'This local folder has no forge remote, so there are no pull requests.';
  }
  if (status.missing) {
    return (
      <>
        <a
          href="/settings#settings-accounts"
          onClick={(event) => {
            event.preventDefault();
            navigate('/settings#settings-accounts');
          }}
        >
          Add a token in Settings
        </a>{' '}
        to list pull requests for this host.
      </>
    );
  }
  if (card?.loading === true) {
    return null;
  }
  return 'No open pull requests.';
}
