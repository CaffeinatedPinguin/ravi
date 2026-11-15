/**
 * One cheap answer for the dashboard: which branch, how far from the upstream, what is dirty in
 * the working tree and the last commit. Everything comes from git; a remote clone has no working
 * tree, so the local-only fields are null there.
 */
import { z } from 'zod';
import type { AppContext } from '../app.ts';
import { diffSummary } from '../git/diff.ts';
import { GitError, gitText } from '../git/exec.ts';
import type { Router } from '../http/router.ts';
import { getRepo } from '../store/repos.ts';
import type { Paths } from '../paths.ts';

/** Mirrored in `src/ui/features/dashboard/schema.ts`; `shared/api.ts` is owned by another task. */
export const RepoSummarySchema = z.object({
  branch: z.string().nullable(),
  ahead: z.number().int().nullable(),
  behind: z.number().int().nullable(),
  uncommitted: z
    .object({
      files: z.number().int().nonnegative(),
      additions: z.number().int().nonnegative(),
      deletions: z.number().int().nonnegative(),
      untracked: z.number().int().nonnegative(),
    })
    .nullable(),
  lastCommit: z
    .object({
      sha: z.string(),
      subject: z.string(),
      date: z.string(),
    })
    .nullable(),
});
export type RepoSummary = z.infer<typeof RepoSummarySchema>;

type AheadBehind = { ahead: number; behind: number };

export function registerSummaryRoutes(router: Router, { paths }: AppContext): void {
  router.get('/api/repos/:id/summary', async ({ params }) => repoSummary(paths, params.id ?? ''));
}

export async function repoSummary(paths: Paths, repoId: string): Promise<RepoSummary> {
  const repo = await getRepo(paths, repoId);
  const isLocal = repo.kind === 'local';

  const [branch, counts, uncommitted, lastCommit] = await Promise.all([
    isLocal ? currentBranch(repo.path) : Promise.resolve(null),
    isLocal ? aheadBehind(repo.path) : Promise.resolve(null),
    isLocal ? uncommittedSummary(repo.path) : Promise.resolve(null),
    // A remote clone is a repository too; its HEAD still names the last fetched commit.
    lastCommitOf(repo.path),
  ]);

  return {
    branch,
    ahead: counts?.ahead ?? null,
    behind: counts?.behind ?? null,
    uncommitted,
    lastCommit,
  };
}

async function currentBranch(root: string): Promise<string | null> {
  try {
    return (await gitText(root, ['branch', '--show-current'])).trim() || null;
  } catch (error) {
    if (error instanceof GitError) {
      return null;
    }
    throw error;
  }
}

/**
 * `@{upstream}...HEAD` prints "<behind> <ahead>": the left side is the upstream. A branch without
 * an upstream (or a deleted one) is a normal state, not an error for the dashboard.
 */
async function aheadBehind(root: string): Promise<AheadBehind | null> {
  try {
    const [behind, ahead] = (await gitText(root, ['rev-list', '--left-right', '--count', '@{upstream}...HEAD']))
      .trim()
      .split(/\s+/)
      .map(Number);
    return ahead === undefined || behind === undefined ? null : { ahead, behind };
  } catch (error) {
    if (error instanceof GitError) {
      return null;
    }
    throw error;
  }
}

async function uncommittedSummary(root: string): Promise<RepoSummary['uncommitted']> {
  const summary = await diffSummary(root, {
    target: { kind: 'uncommitted' },
    ignoreWhitespace: false,
    includeUntracked: true,
  });
  return {
    files: summary.files.length,
    additions: summary.additions,
    deletions: summary.deletions,
    untracked: summary.files.filter((file) => file.status === 'untracked').length,
  };
}

async function lastCommitOf(root: string): Promise<RepoSummary['lastCommit']> {
  try {
    // NUL separates the fields: a subject can contain any printable character, but never NUL.
    const [sha, subject, date] = (await gitText(root, ['log', '-1', '--format=%H%x00%s%x00%cI'])).trim().split('\0');
    return sha === undefined || subject === undefined || date === undefined ? null : { sha, subject, date };
  } catch (error) {
    // A repository without commits has no HEAD yet; that is an empty state, not a failure.
    if (error instanceof GitError) {
      return null;
    }
    throw error;
  }
}
