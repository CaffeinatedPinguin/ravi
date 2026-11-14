/**
 * Opening a pull request for review: fetch its head locally, build the three-dot diff target and
 * collect everything the review screen needs in one answer.
 *
 * The forge and the git fetch are parameters (defaulting to the real implementations) so tests can
 * use a fake forge and a temporary repository without touching the network.
 */
import type { PullRequestOpen, Repo } from '../../shared/api.ts';
import type { RepoRef } from '../../shared/forge.ts';
import { cloneEnv, fetchPullRequest as fetchIntoRefs } from '../git/clone.ts';
import { diffSummary } from '../git/diff.ts';
import { gitText } from '../git/exec.ts';
import { resolveCommit } from '../git/repo.ts';
import { getRepo, touchRepo } from '../store/repos.ts';
import type { Paths } from '../paths.ts';
import { forgeCall } from './errors.ts';
import {
  defaultForgeLookup,
  requireRemote,
  type ForgeLookup,
} from './lookup.ts';

export type OpenDependencies = {
  /** Builds the forge strategy for a connected repository. */
  forgeFor: ForgeLookup;
  /** Fetches `pull/N/head` into the private ref namespace and returns the fetched commit. */
  fetchPullRequest: typeof fetchIntoRefs;
  /** Git authentication environment; local folders use the user's own credentials. */
  envFor: (repo: Repo, remote: RepoRef) => Promise<NodeJS.ProcessEnv>;
};

export function defaultOpenDependencies(paths: Paths): OpenDependencies {
  return {
    forgeFor: defaultForgeLookup(paths),
    fetchPullRequest: fetchIntoRefs,
    envFor: async (repo, remote) => (repo.kind === 'remote' ? cloneEnv(paths, remote) : {}),
  };
}

export async function openPullRequest(
  paths: Paths,
  repoId: string,
  number: number,
  overrides: Partial<OpenDependencies> = {},
): Promise<PullRequestOpen> {
  const deps = { ...defaultOpenDependencies(paths), ...overrides };
  const repo = await getRepo(paths, repoId);
  const remote = requireRemote(repo);
  const forge = await deps.forgeFor(repo);
  const pullRequest = await forgeCall(() => forge.getPullRequest(remote, number));

  const headSha = await deps.fetchPullRequest(
    repo.path,
    repo.kind === 'remote',
    forge.pullRequestRef(number),
    number,
    pullRequest.baseSha,
    await deps.envFor(repo, remote),
  );

  const warnings: string[] = [];
  if (headSha !== pullRequest.headSha) {
    // A push between the API call and the fetch is normal; review what git actually has, but say so
    // so the user knows the answer is newer than the metadata the forge returned.
    warnings.push(`The pull request moved while opening: the forge reported ${pullRequest.headSha}, the fetched head is ${headSha}.`);
  }

  const [threads, currentUser] = await Promise.all([
    forgeCall(() => forge.listThreads(remote, number)),
    forgeCall(() => forge.currentUser()),
  ]);

  // `mergeBaseSha` is informational; `mergeBase: true` makes the diff itself use the common
  // ancestor, which is what the forge's "Files changed" shows after the base branch advanced.
  const baseSha = await resolveCommit(repo.path, pullRequest.baseSha);
  const mergeBaseSha = (await gitText(repo.path, ['merge-base', baseSha, headSha])).trim();
  const diffTarget = { kind: 'range' as const, from: baseSha, to: headSha, mergeBase: true };
  const summary = await diffSummary(repo.path, { target: diffTarget, ignoreWhitespace: false, includeUntracked: false });

  await touchRepo(paths, repo.id);

  return {
    pullRequest: { ...pullRequest, headSha, mergeBaseSha },
    diffTarget,
    diffSummary: summary,
    threads,
    capabilities: forge.capabilities,
    currentUser,
    reviewTarget: {
      kind: 'pullRequest',
      host: remote.host,
      project: remote.project,
      number,
      forge: forge.kind,
    },
    warnings,
  };
}
