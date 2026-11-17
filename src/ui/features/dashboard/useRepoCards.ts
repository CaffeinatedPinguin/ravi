/** Loads the dashboard facts per repository: summary, pull requests, and one visible error/retry. */
import { useCallback, useEffect, useState } from 'react';
import type { Repo } from '../../../shared/api.ts';
import type { PullRequestSummary } from '../../../shared/forge.ts';
import { apiGet } from '../../app/api.ts';
import { errorMessage } from '../../app/errors.ts';
import { PullRequestListSchema } from '../pulls/schemas.ts';
import { mapLimit } from './dashboard.ts';
import { RepoSummarySchema } from './schema.ts';
import type { RepoSummary } from './schema.ts';

export type RepoCard = {
  summary: RepoSummary | null;
  pulls: PullRequestSummary[];
  error: string | null;
  loading: boolean;
};

const EMPTY: Omit<RepoCard, 'loading'> = { summary: null, pulls: [], error: null };

type Cards = Record<string, RepoCard>;

export function useRepoCards(
  repos: readonly Repo[],
  pullEnabled: ReadonlySet<string>,
  refreshKey: number,
): { cards: Cards; reload: (repo: Repo) => void } {
  const [cards, setCards] = useState<Cards>({});

  const loadCard = useCallback(
    async (repo: Repo, signal: AbortSignal): Promise<void> => {
      setCards((previous) => ({ ...previous, [repo.id]: { ...(previous[repo.id] ?? EMPTY), loading: true } }));
      try {
        const summary = repo.kind === 'local' ? await loadSummary(repo.id, signal) : null;
        const pulls = pullEnabled.has(repo.id)
          ? await apiGet(`/api/repos/${repo.id}/pulls?state=open`, PullRequestListSchema, signal)
          : [];
        if (!signal.aborted) {
          setCards((previous) => ({ ...previous, [repo.id]: { summary, pulls, error: null, loading: false } }));
        }
      } catch (reason) {
        if (!signal.aborted) {
          const message = errorMessage(reason, 'Could not load this repository');
          setCards((previous) => ({
            ...previous,
            [repo.id]: { ...(previous[repo.id] ?? EMPTY), error: message, loading: false },
          }));
        }
      }
    },
    [pullEnabled],
  );

  useEffect(() => {
    const controller = new AbortController();
    void mapLimit(repos, 4, (repo) => loadCard(repo, controller.signal));
    return () => controller.abort();
  }, [repos, refreshKey, loadCard]);

  const reload = useCallback(
    (repo: Repo) => {
      void loadCard(repo, new AbortController().signal);
    },
    [loadCard],
  );

  return { cards, reload };
}

async function loadSummary(repoId: string, signal: AbortSignal): Promise<RepoSummary> {
  return apiGet(`/api/repos/${repoId}/summary`, RepoSummarySchema, signal);
}
