/**
 * A cheap value that changes whenever the reviewed state changes.
 * The UI compares it on focus to decide whether reloading a diff is worth it.
 */
import { createHash } from 'node:crypto';
import { lstat, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { DiffTarget } from '../../shared/api.ts';
import { resolveTarget } from './diff.ts';
import { GitError, gitText } from './exec.ts';
import { resolveCommit } from './repo.ts';
import { worktreeRoot } from './worktrees.ts';

/**
 * A diff can list thousands of paths; stat is cheap, but an unbounded `Promise.all` would exhaust
 * file handles on Windows, so metadata is fetched in small sequential batches.
 */
const STAT_BATCH = 64;

export async function diffFingerprint(root: string, target: DiffTarget): Promise<string> {
  // The worktree path is only a lookup key; git's own list decides which folder is inspected.
  const cwd = await worktreeRoot(root, target.worktree);
  const resolved = await resolveTarget(cwd, target);

  // A comparison between two commits cannot be affected by the working tree or the index,
  // so the two ids fully describe it (and are cheaper to read than hashing a diff).
  if (resolved.old.kind === 'commit' && resolved.new.kind === 'commit') {
    return `${resolved.old.sha}..${resolved.new.sha}`;
  }

  // Independent calls: run them together instead of paying the process round-trips in sequence.
  const [head, status, raw, worktree] = await Promise.all([
    headId(cwd),
    gitText(cwd, ['status', '--porcelain=v2', '-z', '--untracked-files=all']),
    gitText(cwd, ['diff', '--raw', '-z', ...resolved.args, '--']),
    resolved.new.kind === 'worktree' ? worktreeContent(cwd, resolved.args) : Promise.resolve(''),
  ]);

  const hash = createHash('sha256');
  // HEAD decides what the comparison is against: a commit, reset or checkout changes it without
  // touching any working-tree file, and the diff would then show something different.
  hash.update(head);
  hash.update('\0');
  // Porcelain v2 lists every path with its staging state, including untracked files, so adding,
  // removing or staging a file is noticed even when the target's own diff would stay empty.
  hash.update(status);
  hash.update('\0');
  // Content ids of the target's diff: staging, deleting or renaming changes them. For a worktree
  // side git prints an all-zero id, so `worktree` below supplies the metadata that is really there.
  hash.update(raw);
  hash.update('\0');
  hash.update(worktree);
  return hash.digest('hex');
}

/**
 * Describes files that differ on the working-tree side by their metadata.
 * Git prints an all-zero id for worktree blobs, so without this input editing an already-modified
 * file would leave both the status and the raw diff unchanged. Size + mtime answer "did anything
 * on disk change" without reading the bytes: a focus refresh must not read hundreds of megabytes
 * of a large generated file just to decide whether a reload is needed.
 */
async function worktreeContent(root: string, args: string[]): Promise<string> {
  const output = await gitText(root, ['diff', '--name-only', '--diff-filter=ACMRT', '-z', ...args, '--']);
  const paths = output.split('\0').filter(Boolean).sort();
  const hash = createHash('sha256');
  for (let start = 0; start < paths.length; start += STAT_BATCH) {
    const entries = await Promise.all(
      paths.slice(start, start + STAT_BATCH).map(async (path) => {
        try {
          // stat follows a symlink, whose target's metadata is what changes; lstat covers a dangling
          // link, whose own metadata still changes when it is relinked.
          const info = await stat(join(root, path)).catch(() => lstat(join(root, path)));
          return `${path}\0${info.size}:${info.mtimeMs}`;
        } catch {
          // A file that disappeared between listing and stat is already covered by `status`.
          return `${path}\0missing`;
        }
      }),
    );
    hash.update(entries.join('\0'));
    hash.update('\0');
  }
  return hash.digest('hex');
}

/** HEAD is absent in a repository without commits; a literal keeps the fingerprint hashable. */
async function headId(root: string): Promise<string> {
  try {
    return await resolveCommit(root, 'HEAD');
  } catch (error) {
    if (error instanceof GitError) {
      return 'no-head';
    }
    throw error;
  }
}
