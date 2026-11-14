/** Facts about a repository: where its root is, which branches it has. */
import type { RepoInfo } from '../../shared/api.ts';
import { GitError, gitText } from './exec.ts';

/** Returns the working tree root for a folder inside a repository, or `null` if it is not one. */
export async function findRepoRoot(folder: string): Promise<string | null> {
  try {
    return (await gitText(folder, ['rev-parse', '--show-toplevel'])).trim();
  } catch (error) {
    if (error instanceof GitError) {
      return null;
    }
    throw error;
  }
}

export async function readRepoInfo(root: string): Promise<RepoInfo> {
  const [branch, branches, remoteHead] = await Promise.all([
    gitText(root, ['branch', '--show-current']).then((text) => text.trim() || null),
    gitText(root, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']).then((text) => text.split('\n').filter(Boolean)),
    // Set by `git clone`; absent in repositories without a remote.
    gitText(root, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']).then(
      (text) => text.trim(),
      () => null,
    ),
  ]);
  return { branch, branches, defaultBranch: pickDefaultBranch(branches, remoteHead) };
}

function pickDefaultBranch(branches: string[], remoteHead: string | null): string | null {
  if (remoteHead !== null && remoteHead !== '') {
    return remoteHead;
  }
  return ['main', 'master', 'develop'].find((name) => branches.includes(name)) ?? null;
}

/** Resolves a ref to a commit hash; a ref that looks like an option is rejected before git sees it. */
export async function resolveCommit(root: string, ref: string): Promise<string> {
  if (ref.startsWith('-')) {
    throw new GitError(['rev-parse', ref], null, 'invalid ref');
  }
  return (await gitText(root, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`])).trim();
}
