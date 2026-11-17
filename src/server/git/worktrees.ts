/**
 * Linked worktrees of a connected repository. A request may name one, but that name is only a
 * lookup key: every git call and working-tree read then uses the path git itself printed.
 */
import { resolve } from 'node:path';
import type { Worktree } from '../../shared/api.ts';
import { HttpError } from '../http/router.ts';
import { GitError, gitText } from './exec.ts';

const BRANCH_PREFIX = 'refs/heads/';

/**
 * Windows paths differ only in case and separators; compare them the way the OS does. Git prints
 * forward slashes while a request or `os.tmpdir()` may use backslashes, so both are normalized.
 */
export function samePath(left: string, right: string): boolean {
  const normalize = (value: string): string => resolve(value).replaceAll('\\', '/').replace(/\/+$/, '');
  const a = normalize(left);
  const b = normalize(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

export async function listWorktrees(root: string): Promise<Worktree[]> {
  let output: string;
  try {
    output = await gitText(root, ['worktree', 'list', '--porcelain', '-z']);
  } catch (error) {
    // A folder that is not a repository has no worktrees; an empty list is the honest answer.
    if (error instanceof GitError) {
      return [];
    }
    throw error;
  }
  return parseWorktrees(output, root);
}

/**
 * Parses `git worktree list --porcelain -z`: every attribute ends with NUL and an extra NUL ends
 * the record. Attribute values may contain spaces (a folder name), so only the first space splits.
 */
export function parseWorktrees(output: string, root: string): Worktree[] {
  const worktrees: Worktree[] = [];
  let record: string[] = [];
  for (const line of output.split('\0')) {
    if (line !== '') {
      record.push(line);
      continue;
    }
    appendRecord(worktrees, record, root);
    record = [];
  }
  // Tolerate output without the trailing record separator, which some shells/versions may trim.
  appendRecord(worktrees, record, root);
  return worktrees;
}

function appendRecord(worktrees: Worktree[], record: string[], root: string): void {
  if (record.length === 0) {
    return;
  }
  const worktree = parseRecord(record, worktrees.length === 0, root);
  if (worktree !== null) {
    worktrees.push(worktree);
  }
}

function parseRecord(record: string[], main: boolean, root: string): Worktree | null {
  let path: string | null = null;
  let head: string | null = null;
  let branch: string | null = null;
  let bare = false;
  let prunable = false;
  for (const line of record) {
    const space = line.indexOf(' ');
    const key = space === -1 ? line : line.slice(0, space);
    const value = space === -1 ? '' : line.slice(space + 1);
    switch (key) {
      case 'worktree':
        path = value;
        break;
      case 'HEAD':
        head = value === '' ? null : value;
        break;
      case 'branch':
        branch = value.startsWith(BRANCH_PREFIX) ? value.slice(BRANCH_PREFIX.length) : value;
        break;
      case 'bare':
        bare = true;
        break;
      case 'prunable':
        prunable = true;
        break;
    }
  }
  if (path === null || path === '' || bare || prunable) {
    return null;
  }
  return { path, branch, head, main, current: samePath(path, root) };
}

/**
 * The folder to run git in and to read working-tree files from. The request value is never used
 * as a path: an unlisted folder (or a sibling repository) is a 404, and the listed path wins.
 */
export async function worktreeRoot(root: string, worktree: string | undefined): Promise<string> {
  if (worktree === undefined) {
    return root;
  }
  const listed = await listWorktrees(root);
  const match = listed.find((entry) => samePath(entry.path, worktree));
  if (match === undefined) {
    throw new HttpError(404, 'Unknown worktree');
  }
  return match.path;
}
