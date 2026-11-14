/**
 * A cheap value that changes whenever the reviewed state changes.
 * The UI compares it on focus to decide whether reloading a diff is worth it.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DiffTarget } from '../../shared/api.ts';
import { resolveTarget } from './diff.ts';
import { GitError, gitText } from './exec.ts';
import { resolveCommit } from './repo.ts';

export async function diffFingerprint(root: string, target: DiffTarget): Promise<string> {
  const resolved = await resolveTarget(root, target);

  // A comparison between two commits cannot be affected by the working tree or the index,
  // so the two ids fully describe it (and are cheaper to read than hashing a diff).
  if (resolved.old.kind === 'commit' && resolved.new.kind === 'commit') {
    return `${resolved.old.sha}..${resolved.new.sha}`;
  }

  // Independent calls: run them together instead of paying the process round-trips in sequence.
  const [head, status, raw, worktree] = await Promise.all([
    headId(root),
    gitText(root, ['status', '--porcelain=v2', '-z', '--untracked-files=all']),
    gitText(root, ['diff', '--raw', '-z', ...resolved.args, '--']),
    resolved.new.kind === 'worktree' ? worktreeContent(root, resolved.args) : Promise.resolve(''),
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
  // side git prints an all-zero id, so `worktree` below supplies the bytes that are really there.
  hash.update(raw);
  hash.update('\0');
  hash.update(worktree);
  return hash.digest('hex');
}

/**
 * Hashes the current bytes of files that differ on the working-tree side.
 * Without this, editing an already-modified file would leave both the status and the raw diff
 * unchanged (git reports `0000000` for worktree blobs), so a focus would miss the edit.
 */
async function worktreeContent(root: string, args: string[]): Promise<string> {
  const output = await gitText(root, ['diff', '--name-only', '--diff-filter=ACMRT', '-z', ...args, '--']);
  const paths = output.split('\0').filter(Boolean).sort();
  const hash = createHash('sha256');
  for (const path of paths) {
    hash.update(path);
    hash.update('\0');
    try {
      hash.update(await readFile(join(root, path)));
    } catch {
      // A file that disappeared between listing and reading is already covered by `status`.
    }
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
