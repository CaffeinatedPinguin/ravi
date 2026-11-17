/** The list of connected local folders and remote clones. */
import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { RepoListSchema } from '../../shared/api.ts';
import type { Repo, RepoTokenScope } from '../../shared/api.ts';
import type { RepoRef } from '../../shared/forge.ts';
import { detectRepoRef } from '../forges/remote.ts';
import { findRepoRoot } from '../git/repo.ts';
import { HttpError } from '../http/router.ts';
import type { Paths } from '../paths.ts';
import { readJsonFile, writeJsonFile } from './json-file.ts';

const SCAN_DEPTH = 4;
const SCAN_SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'target', 'vendor']);

const file = (paths: Paths) => join(paths.data, 'repos.json');

export async function listRepos(paths: Paths): Promise<Repo[]> {
  const repos = await readJsonFile(file(paths), RepoListSchema, []);
  // Files written before token scopes existed get the same default a fresh repository would have;
  // the plain object parser already drops retired fields from older files.
  return repos
    .map((repo) => ({ ...repo, tokenScope: repo.tokenScope ?? 'repo' }))
    .sort((left, right) => right.lastUsedAt.localeCompare(left.lastUsedAt));
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
  // A local folder keeps using the user's own git credentials; the forge is remembered only so the
  // UI can offer pull requests, never to authenticate git.
  const repo: Repo = {
    id: repoId(root),
    path: root,
    name: basename(root),
    lastUsedAt: new Date().toISOString(),
    kind: 'local',
    remote: await detectRepoRef(root),
    tokenScope: 'repo',
  };
  const others = (await listRepos(paths)).filter((candidate) => candidate.id !== repo.id);
  await writeJsonFile(file(paths), [repo, ...others]);
  return repo;
}

/** Remembers a remote repository that has just been cloned; its path is derived, never user text. */
export async function addRemoteRepo(
  paths: Paths,
  ref: RepoRef,
  connection: { tokenScope: RepoTokenScope } = { tokenScope: 'repo' },
): Promise<Repo> {
  const path = cloneFolder(paths, ref);
  const repo: Repo = {
    id: repoId(path),
    path,
    name: ref.project.split('/').at(-1) ?? ref.project,
    lastUsedAt: new Date().toISOString(),
    kind: 'remote',
    remote: ref,
    tokenScope: connection.tokenScope,
  };
  const others = (await listRepos(paths)).filter((candidate) => candidate.id !== repo.id);
  await writeJsonFile(file(paths), [repo, ...others]);
  return repo;
}

/** Id a remote repository will get before it is cloned; the token has to exist before the clone. */
export function remoteRepoId(paths: Paths, ref: RepoRef): string {
  return repoId(cloneFolder(paths, ref));
}

/** Stores the connection choices; the token itself lives only in `.env`. */
export async function setRepoConnection(
  paths: Paths,
  id: string,
  connection: { tokenScope: RepoTokenScope },
): Promise<Repo> {
  const repos = await listRepos(paths);
  const current = repos.find((candidate) => candidate.id === id);
  if (current === undefined) {
    throw new HttpError(404, 'Repository is not connected');
  }
  const updated: Repo = { ...current, tokenScope: connection.tokenScope };
  await writeJsonFile(file(paths), [updated, ...repos.filter((candidate) => candidate.id !== id)]);
  return updated;
}

/** Records that a repository was used now, so automatic pruning leaves it alone. */
export async function touchRepo(paths: Paths, id: string): Promise<Repo> {
  const repos = await listRepos(paths);
  const current = repos.find((candidate) => candidate.id === id);
  if (current === undefined) {
    throw new HttpError(404, 'Repository is not connected');
  }
  const updated: Repo = { ...current, lastUsedAt: new Date().toISOString() };
  await writeJsonFile(file(paths), [updated, ...repos.filter((candidate) => candidate.id !== id)]);
  return updated;
}

export async function removeRepo(paths: Paths, id: string): Promise<void> {
  const repos = await listRepos(paths);
  await writeJsonFile(
    file(paths),
    repos.filter((repo) => repo.id !== id),
  );
}

/**
 * Where a remote repository is cloned: `clones/<host>/<project with / → __>.git`.
 * Validating the two components here keeps every caller from turning a pasted URL into a path.
 */
export function cloneFolder(paths: Paths, ref: RepoRef): string {
  const folder = ref.project.replaceAll('/', '__');
  const hostOk = /^[a-z0-9][a-z0-9.-]*$/.test(ref.host) && !ref.host.includes('..');
  if (folder === '' || folder === '.' || folder === '..' || /[\\/:]/.test(folder) || !hostOk) {
    throw new HttpError(400, 'Invalid repository reference');
  }
  return join(paths.clones, ref.host, `${folder}.git`);
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
