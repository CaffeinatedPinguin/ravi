import { describe, expect, it } from 'vitest';
import type { Repo } from '../../../shared/api.ts';
import type { PullRequestSummary } from '../../../shared/forge.ts';
import { filterRepos, groupPullRequests, mapLimit, repoTarget, startView } from './dashboard.ts';

function pull(number: number, flags: Partial<PullRequestSummary> = {}): PullRequestSummary {
  return {
    number,
    title: `Pull ${number}`,
    author: 'alice',
    state: 'open',
    draft: false,
    updatedAt: '2026-11-15T10:00:00.000Z',
    baseRef: 'main',
    headRef: `feature-${number}`,
    headSha: `sha${number}`,
    webUrl: `https://github.com/acme/api/pull/${number}`,
    commentCount: 0,
    ...flags,
  };
}

function repo(id: string, name: string, path: string, kind: Repo['kind'] = 'local'): Repo {
  return { id, name, path, kind, lastUsedAt: '2026-11-15T10:00:00.000Z', remote: null };
}

describe('dashboard helpers', () => {
  it('groups pull requests waiting for me, mine, and everything else', () => {
    const groups = groupPullRequests([
      pull(1, { reviewRequested: true, isMine: true }),
      pull(2, { reviewRequested: true }),
      pull(3, { isMine: true }),
      pull(4),
      pull(5),
    ]);

    expect(groups.reviewRequested.map((entry) => entry.number)).toEqual([1, 2]);
    expect(groups.mine.map((entry) => entry.number)).toEqual([3]);
    expect(groups.other.map((entry) => entry.number)).toEqual([4, 5]);
  });

  it('filters repositories by a case-insensitive fragment of the name or path', () => {
    const repos = [
      repo('a1b2c3d4', 'ravi', '/src/ravi'),
      repo('b1b2c3d4', 'dashboard', '/work/RAVI-dashboard'),
      repo('c1b2c3d4', 'other', '/work/other'),
    ];

    expect(filterRepos(repos, 'RAVI').map((entry) => entry.name)).toEqual(['ravi', 'dashboard']);
    expect(filterRepos(repos, ' work/other ').map((entry) => entry.name)).toEqual(['other']);
    expect(filterRepos(repos, '')).toEqual(repos);
  });

  it('chooses setup only while nothing is connected', () => {
    expect(startView([])).toBe('setup');
    expect(startView([repo('a1b2c3d4', 'ravi', '/src/ravi')])).toBe('dashboard');
  });

  it('opens a remote repository on its pull requests and a local one on its review', () => {
    expect(repoTarget(repo('a1b2c3d4', 'ravi', '/src/ravi'))).toBe('/repo/a1b2c3d4');
    expect(repoTarget(repo('b1b2c3d4', 'api', '/clones/api.git', 'remote'))).toBe('/repo/b1b2c3d4/pulls');
  });

  it('loads at most the requested number of repositories at once', async () => {
    let running = 0;
    let peak = 0;
    const finished: number[] = [];

    await mapLimit([1, 2, 3, 4, 5, 6, 7], 4, async (item) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      finished.push(item);
      running -= 1;
    });

    expect(peak).toBeLessThanOrEqual(4);
    expect(finished.sort((left, right) => left - right)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});
