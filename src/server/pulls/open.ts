/**
 * Opening a pull request for review: fetch its head locally, build the three-dot diff target and
 * collect everything the review screen needs in one answer.
 *
 * The forge and the git fetch are parameters (defaulting to the real implementations) so tests can
 * use a fake forge and a temporary repository without touching the network.
 */
import type { PullRequestOpen, Repo } from '../../shared/api.ts';
import type { RepoRef } from '../../shared/forge.ts';
import type { ReviewTarget } from '../../shared/review.ts';
import type { Forge } from '../forges/forge.ts';
import { cloneEnv, fetchPullRequest as fetchIntoRefs } from '../git/clone.ts';
import { diffSummary } from '../git/diff.ts';
import { gitText } from '../git/exec.ts';
import { resolveCommit } from '../git/repo.ts';
import { readReview, writeReview } from '../review/store.ts';
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

/**
 * The answer of `open`, extended with the URL shapes the UI must not know by itself. The shared
 * schema stays untouched because other tasks own it; the UI validates this with a local schema.
 */
export type PullRequestOpenResponse = PullRequestOpen & {
  /** New-side file URL; `{path}` and `{line}` are filled by the UI. */
  fileUrlTemplate: string;
  /** Base-side file URL for old lines and deleted files. */
  oldFileUrlTemplate: string;
};

/** Placeholders the forge URL is built with; they cannot collide with a real path or line number. */
const TEMPLATE_PATH = 'RAVI_PATH';
const TEMPLATE_LINE = 999999;

/**
 * Turns one concrete forge URL into a template. The UI never learns GitHub's `/blob/` or GitLab's
 * `/-/blob/` shape; it only fills the two placeholders the server put in.
 */
export function toFileUrlTemplate(url: string): string {
  // Replace the anchor as a whole: a bare `999999` could legitimately appear in a project path.
  return url.split(TEMPLATE_PATH).join('{path}').split(`#L${TEMPLATE_LINE}`).join('#L{line}');
}

/** A file URL template for one commit of a connected forge repository. */
export function fileUrlTemplateFor(forge: Forge, remote: RepoRef, sha: string): string {
  return toFileUrlTemplate(forge.webUrl(remote, sha, TEMPLATE_PATH, TEMPLATE_LINE));
}

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
): Promise<PullRequestOpenResponse> {
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

  const reviewTarget: ReviewTarget = {
    kind: 'pullRequest',
    host: remote.host,
    project: remote.project,
    number,
    forge: forge.kind,
  };

  // Send must be able to tell that the pull request moved after the review was opened. The stored
  // document keeps its comments: only the anchoring commits are refreshed here.
  const stored = await readReview(paths, repo.id, reviewTarget);
  await writeReview(paths, repo.id, { ...stored, baseSha, headSha });

  await touchRepo(paths, repo.id);

  return {
    pullRequest: { ...pullRequest, headSha, mergeBaseSha },
    diffTarget,
    diffSummary: summary,
    threads,
    capabilities: forge.capabilities,
    currentUser,
    reviewTarget,
    warnings,
    fileUrlTemplate: fileUrlTemplateFor(forge, remote, headSha),
    oldFileUrlTemplate: fileUrlTemplateFor(forge, remote, baseSha),
  };
}
