/**
 * Turns a `DiffTarget` into git calls: the list of changed files, patches for a batch of files,
 * and file content at either side of the comparison.
 *
 * Performance model for huge diffs: the file list comes from one cheap `--raw --numstat` call;
 * patch text is only produced for the files the UI is about to show, a batch at a time.
 */
import { readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { DiffFile, DiffOptions, DiffSummary, DiffTarget, Patches, PatchesRequest } from '../../shared/api.ts';
import { HttpError } from '../http/router.ts';
import { GitError, git, gitText } from './exec.ts';
import { compareTreeOrder, parseRawNumstat, splitPatches } from './parse.ts';
import { resolveCommit } from './repo.ts';
import { worktreeRoot } from './worktrees.ts';

/** The hash of the empty tree: lets a repository without commits be diffed like any other. */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const MAX_BLOB_BYTES = 8 * 1024 * 1024;
/** Larger untracked files are listed without line counts instead of being read. */
const MAX_UNTRACKED_COUNT_BYTES = 2 * 1024 * 1024;

const COMMON_ARGS = ['--no-ext-diff', '--no-color', '-M'];

/** One side of a comparison. */
type Revision = { kind: 'commit'; sha: string } | { kind: 'index' } | { kind: 'worktree' };

type ResolvedTarget = {
  /** Positional arguments for `git diff` that select the two sides. */
  args: string[];
  old: Revision;
  new: Revision;
};

export async function resolveTarget(root: string, target: DiffTarget): Promise<ResolvedTarget> {
  switch (target.kind) {
    case 'uncommitted': {
      const head = await headOrEmptyTree(root);
      return { args: [head], old: { kind: 'commit', sha: head }, new: { kind: 'worktree' } };
    }
    case 'unstaged':
      return { args: [], old: { kind: 'index' }, new: { kind: 'worktree' } };
    case 'staged': {
      const head = await headOrEmptyTree(root);
      return { args: ['--cached', head], old: { kind: 'commit', sha: head }, new: { kind: 'index' } };
    }
    case 'branch': {
      const head = await resolveCommit(root, 'HEAD');
      const base = await mergeBase(root, await resolveCommit(root, target.base), head);
      return commitRange(base, head);
    }
    case 'range': {
      const to = await resolveCommit(root, target.to);
      const from = await resolveCommit(root, target.from);
      return commitRange(target.mergeBase ? await mergeBase(root, from, to) : from, to);
    }
  }
}

function commitRange(from: string, to: string): ResolvedTarget {
  return { args: [from, to], old: { kind: 'commit', sha: from }, new: { kind: 'commit', sha: to } };
}

async function headOrEmptyTree(root: string): Promise<string> {
  try {
    return await resolveCommit(root, 'HEAD');
  } catch (error) {
    if (error instanceof GitError) {
      return EMPTY_TREE;
    }
    throw error;
  }
}

async function mergeBase(root: string, left: string, right: string): Promise<string> {
  return (await gitText(root, ['merge-base', left, right])).trim();
}

export async function diffSummary(root: string, options: DiffOptions): Promise<DiffSummary> {
  // A requested worktree is accepted only when git lists it; the request value is never a path.
  const cwd = await worktreeRoot(root, options.target.worktree);
  const target = await resolveTarget(cwd, options.target);
  const output = await gitText(cwd, ['diff', '--raw', '--numstat', '-z', ...COMMON_ARGS, ...whitespaceArgs(options), ...target.args, '--']);
  const files = parseRawNumstat(output);
  if (options.includeUntracked && target.new.kind === 'worktree') {
    files.push(...(await untrackedFiles(cwd)));
  }
  files.sort((left, right) => compareTreeOrder(left.path, right.path));
  return {
    files,
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
  };
}

async function untrackedFiles(root: string): Promise<DiffFile[]> {
  const output = await gitText(root, ['ls-files', '--others', '--exclude-standard', '-z']);
  const paths = output.split('\0').filter(Boolean);
  return Promise.all(
    paths.map(async (path): Promise<DiffFile> => {
      const lines = await countLines(join(root, path));
      return { path, oldPath: null, status: 'untracked', additions: lines ?? 0, deletions: 0, binary: lines === null };
    }),
  );
}

/** Line count of a text file, or `null` when it is binary, too large or unreadable. */
async function countLines(file: string): Promise<number | null> {
  try {
    if ((await stat(file)).size > MAX_UNTRACKED_COUNT_BYTES) {
      return null;
    }
    const content = await readFile(file);
    if (content.includes(0)) {
      return null;
    }
    let lines = 0;
    for (const byte of content) {
      if (byte === 10) {
        lines += 1;
      }
    }
    return content.length > 0 && content.at(-1) !== 10 ? lines + 1 : lines;
  } catch {
    return null;
  }
}

export async function diffPatches(root: string, request: PatchesRequest): Promise<Patches> {
  // Same rule as the summary: only a path listed by git can become the git cwd.
  const cwd = await worktreeRoot(root, request.target.worktree);
  const target = await resolveTarget(cwd, request.target);
  const patches: Patches = {};
  const tracked = request.files.filter((file) => file.status !== 'untracked');
  const untracked = request.files.filter((file) => file.status === 'untracked');

  if (tracked.length > 0) {
    // Both names of a rename must be in the pathspec, or git reports it as an unrelated add.
    const paths = tracked.flatMap((file) => (file.oldPath === null ? [file.path] : [file.path, file.oldPath]));
    const output = await gitText(cwd, [
      'diff',
      ...COMMON_ARGS,
      ...whitespaceArgs(request),
      ...target.args,
      '--',
      // `:(literal)` stops git from treating `*`, `?` or `[` in a file name as a pattern.
      ...paths.map((path) => `:(literal)${path}`),
    ]);
    for (const [path, patch] of splitPatches(output)) {
      patches[path] = patch;
    }
  }

  await Promise.all(
    untracked.map(async (file) => {
      assertRelativePath(file.path);
      // Exit code 1 means "the files differ", which is always the case against /dev/null.
      const output = await gitText(cwd, ['diff', '--no-index', ...COMMON_ARGS, '--', '/dev/null', file.path], { okExitCodes: [0, 1] });
      patches[file.path] = output;
    }),
  );
  return patches;
}

function whitespaceArgs(options: { ignoreWhitespace: boolean }): string[] {
  return options.ignoreWhitespace ? ['-w'] : [];
}

/** Lines of a file at one side of the comparison; an absent file (added or deleted) has no lines. */
export async function readBlobLines(root: string, target: DiffTarget, side: 'old' | 'new', path: string): Promise<string[]> {
  // A worktree path is validated against git's list before it can become the read root.
  const cwd = await worktreeRoot(root, target.worktree);
  assertRelativePath(path);
  const resolved = await resolveTarget(cwd, target);
  const content = await readRevision(cwd, side === 'old' ? resolved.old : resolved.new, path);
  if (content === null) {
    return [];
  }
  if (content.length > MAX_BLOB_BYTES) {
    throw new HttpError(413, 'File is too large to display');
  }
  const lines = content.toString('utf8').split('\n');
  if (lines.at(-1) === '') {
    lines.pop();
  }
  return lines;
}

async function readRevision(root: string, revision: Revision, path: string): Promise<Buffer | null> {
  if (revision.kind === 'worktree') {
    try {
      return await readFile(await resolveInside(root, path));
    } catch (error) {
      if (error instanceof HttpError) {
        throw error;
      }
      return null;
    }
  }
  const object = revision.kind === 'index' ? `:${path}` : `${revision.sha}:${path}`;
  try {
    return await git(root, ['cat-file', 'blob', object]);
  } catch (error) {
    if (error instanceof GitError) {
      return null;
    }
    throw error;
  }
}

function assertRelativePath(path: string): void {
  if (isAbsolute(path) || path.split(/[\\/]/).includes('..')) {
    throw new HttpError(400, 'Path must be relative to the repository');
  }
}

/** Resolves a repository-relative path and refuses anything that ends up outside the repository, symlinks included. */
async function resolveInside(root: string, path: string): Promise<string> {
  const [realRoot, realFile] = await Promise.all([realpath(root), realpath(resolve(root, path))]);
  const offset = relative(realRoot, realFile);
  if (offset === '' || offset.startsWith(`..${sep}`) || offset === '..' || isAbsolute(offset)) {
    throw new HttpError(400, 'Path is outside the repository');
  }
  return realFile;
}
