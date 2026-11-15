/** Pure rules of the dashboard: the first screen, repository search, PR groups and a small limiter. */
import type { Repo } from '../../../shared/api.ts';
import type { PullRequestSummary } from '../../../shared/forge.ts';

export type PullGroups = {
  reviewRequested: PullRequestSummary[];
  mine: PullRequestSummary[];
  other: PullRequestSummary[];
};

/**
 * The dashboard asks for one group per decision; a pull that asks for my review belongs there even
 * when I also wrote it, so that check comes first.
 */
export function groupPullRequests(pulls: readonly PullRequestSummary[]): PullGroups {
  const groups: PullGroups = { reviewRequested: [], mine: [], other: [] };
  for (const pull of pulls) {
    if (pull.reviewRequested === true) {
      groups.reviewRequested.push(pull);
    } else if (pull.isMine === true) {
      groups.mine.push(pull);
    } else {
      groups.other.push(pull);
    }
  }
  return groups;
}

/** Case-insensitive substring match on the name and the path, like every other filter in revu. */
export function filterRepos<T extends Pick<Repo, 'name' | 'path'>>(repos: readonly T[], query: string): T[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') {
    return [...repos];
  }
  return repos.filter(
    (repo) => repo.name.toLowerCase().includes(needle) || repo.path.toLowerCase().includes(needle),
  );
}

/** The first-run setup replaces the dashboard exactly when nothing is connected yet. */
export function startView(repos: readonly unknown[]): 'setup' | 'dashboard' {
  return repos.length === 0 ? 'setup' : 'dashboard';
}

export function repoTarget(repo: Pick<Repo, 'id' | 'kind'>): string {
  return repo.kind === 'remote' ? `/repo/${repo.id}/pulls` : `/repo/${repo.id}`;
}

/**
 * Runs `load` over the repositories with at most `limit` in flight. The dashboard uses this so one
 * slow forge (or a huge working tree) never blocks every other repository section.
 */
export async function mapLimit<T>(items: readonly T[], limit: number, load: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next;
      next += 1;
      const item = items[index];
      if (item !== undefined) {
        await load(item);
      }
    }
  };
  const width = Math.min(Math.max(limit, 1), items.length);
  await Promise.all(Array.from({ length: width }, worker));
}
