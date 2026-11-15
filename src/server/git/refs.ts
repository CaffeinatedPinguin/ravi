/** Everything a review can start from: local and remote branches, tags and the most recent commits. */
import type { Refs } from '../../shared/api.ts';
import { GitError, gitText } from './exec.ts';

/**
 * The commit list is a starting point, not a history browser: every extra row would travel to the
 * browser on each picker mount, and nobody scrolls two hundred commits to find a ref they can type.
 */
export const MAX_COMMITS = 200;

export async function readRefs(root: string): Promise<Refs> {
  const [headRefs, remoteRefs, tagRefs, commits] = await Promise.all([
    listRefs(root, 'refs/heads', 'refname'),
    listRefs(root, 'refs/remotes', 'refname'),
    // `creatordate` is the tagger date for annotated tags and the commit date for lightweight ones.
    listRefs(root, 'refs/tags', '-creatordate'),
    recentCommits(root),
  ]);
  return {
    branches: headRefs.map((ref) => ref.slice('refs/heads/'.length)),
    // `refs/remotes/origin/HEAD` is an alias for one of the branches below, not a branch itself.
    // Filtering happens on the full name: `%(refname:short)` would collapse it to `origin`.
    remoteBranches: remoteRefs
      .filter((ref) => !ref.endsWith('/HEAD'))
      .map((ref) => ref.slice('refs/remotes/'.length)),
    tags: tagRefs.map((ref) => ref.slice('refs/tags/'.length)),
    commits,
  };
}

async function listRefs(root: string, namespace: string, sort: string): Promise<string[]> {
  const text = await gitText(root, ['for-each-ref', `--sort=${sort}`, '--format=%(refname)', namespace]);
  return text.split('\n').filter(Boolean);
}

async function recentCommits(root: string): Promise<Refs['commits']> {
  try {
    // NUL separates the fields: a subject can contain any printable character, but never NUL.
    const text = await gitText(root, ['log', '-n', String(MAX_COMMITS), '--format=%H%x00%h%x00%cI%x00%s', 'HEAD']);
    return text
      .split('\n')
      .filter(Boolean)
      .flatMap((line) => {
        const [sha, shortSha, date, subject] = line.split('\0');
        return sha === undefined || shortSha === undefined || date === undefined || subject === undefined
          ? []
          : [{ sha, shortSha, date, subject }];
      });
  } catch (error) {
    // A repository without commits has no HEAD yet; that is an empty state, not a failure.
    if (error instanceof GitError) {
      return [];
    }
    throw error;
  }
}
