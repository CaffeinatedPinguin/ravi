/** The list of connected local folders. */
import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { RepoListSchema } from '../../shared/api.ts';
import type { Repo } from '../../shared/api.ts';
import { findRepoRoot } from '../git/repo.ts';
import { HttpError } from '../http/router.ts';
import type { Paths } from '../paths.ts';
import { readJsonFile, writeJsonFile } from './json-file.ts';

const SCAN_DEPTH = 4;
const SCAN_SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'target', 'vendor']);

const file = (paths: Paths) => join(paths.data, 'repos.json');

export async function listRepos(paths: Paths): Promise<Repo[]> {
  const repos = await readJsonFile(file(paths), RepoListSchema, []);
  return repos.sort((left, right) => right.lastUsedAt.localeCompare(left.lastUsedAt));
}

export async function getRepo(paths: Paths, id: string): Promise<Repo> {
  const repo = (await listRepos(paths)).find((candidate) => candidate.id === id);
  if (!repo) {
    throw new HttpError(404, 'Repository is not connected');
  }
  return repo;
}

/** Connects the repository that contains `folder`; connecting it again only refreshes its "last used" time. */
export async function addRepo(paths: Paths, folder: string): Promise<Repo> {
  const root = await findRepoRoot(folder).catch(() => null);
  if (root === null) {
    throw new HttpError(400, `Not a git repository: ${folder}`);
  }
  const repo: Repo = { id: repoId(root), path: root, name: basename(root), lastUsedAt: new Date().toISOString() };
  const others = (await listRepos(paths)).filter((candidate) => candidate.id !== repo.id);
  await writeJsonFile(file(paths), [repo, ...others]);
  return repo;
}

export async function removeRepo(paths: Paths, id: string): Promise<void> {
  const repos = await listRepos(paths);
  await writeJsonFile(
    file(paths),
    repos.filter((repo) => repo.id !== id),
  );
}

/** Finds git working trees below a folder, without descending into the repositories themselves. */
export async function scanForRepos(folder: string): Promise<string[]> {
  const found: string[] = [];
  const visit = async (directory: string, depth: number): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    if (entries.some((entry) => entry.name === '.git')) {
      found.push(directory);
      return;
    }
    if (depth === 0) {
      return;
    }
    const children = entries.filter((entry) => entry.isDirectory() && !SCAN_SKIP.has(entry.name) && !entry.name.startsWith('.'));
    await Promise.all(children.map((entry) => visit(join(directory, entry.name), depth - 1)));
  };
  await visit(folder, SCAN_DEPTH);
  return found.sort();
}

/** Stable id derived from the path, so the same folder always maps to the same stored reviews. */
function repoId(root: string): string {
  return createHash('sha1').update(root.toLowerCase()).digest('hex').slice(0, 12);
}
