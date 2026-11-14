/** Read-only pull request queries: list, thread refresh and the cheap change check. */
import type { PullRequestStatus } from '../../shared/api.ts';
import type { PullRequestSummary, Thread } from '../../shared/forge.ts';
import { getRepo } from '../store/repos.ts';
import type { Paths } from '../paths.ts';
import { forgeCall } from './errors.ts';
import { defaultForgeLookup, requireRemote } from './lookup.ts';
import type { ForgeLookup } from './lookup.ts';

export type ListPullRequestsOptions = {
  state: 'open' | 'all';
  /** Limit the answer to pull requests authored by the token's user. */
  mine: boolean;
};

export async function listPullRequests(
  paths: Paths,
  repoId: string,
  options: ListPullRequestsOptions,
  forgeFor: ForgeLookup = defaultForgeLookup(paths),
): Promise<PullRequestSummary[]> {
  const repo = await getRepo(paths, repoId);
  const remote = requireRemote(repo);
  const forge = await forgeFor(repo);
  const author = options.mine ? await forgeCall(() => forge.currentUser()) : undefined;
  const pullRequests = await forgeCall(() =>
    forge.listPullRequests(remote, author === undefined ? { state: options.state } : { state: options.state, author }),
  );
  // The forge already sorts newest first, but the UI relies on it: keep the contract deterministic.
  return [...pullRequests].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function pullRequestThreads(
  paths: Paths,
  repoId: string,
  number: number,
  forgeFor: ForgeLookup = defaultForgeLookup(paths),
): Promise<Thread[]> {
  const repo = await getRepo(paths, repoId);
  const remote = requireRemote(repo);
  const forge = await forgeFor(repo);
  return forgeCall(() => forge.listThreads(remote, number));
}

export async function pullRequestStatus(
  paths: Paths,
  repoId: string,
  number: number,
  forgeFor: ForgeLookup = defaultForgeLookup(paths),
): Promise<PullRequestStatus> {
  const repo = await getRepo(paths, repoId);
  const remote = requireRemote(repo);
  const forge = await forgeFor(repo);
  const pullRequest = await forgeCall(() => forge.getPullRequest(remote, number));
  return { headSha: pullRequest.headSha, state: pullRequest.state, updatedAt: pullRequest.updatedAt };
}
