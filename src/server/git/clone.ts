/**
 * Bare blobless clones and private pull request refs.
 *
 * A remote repository is kept as a bare, blobless partial clone: history and file names are local,
 * while file contents are downloaded on demand. That keeps `~/.revu/clones` small and makes listing
 * a huge repository cheap. Pull request heads never touch the user's branches; they live under the
 * private `refs/revu/pr` namespace.
 *
 * Authentication is passed through the environment, never through argv: command-line arguments are
 * visible to other processes on the same machine, so the token must not be one of them.
 */
import { mkdir, readdir, realpath, rename, rm, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { CloneInfo } from '../../shared/api.ts';
import type { ForgeKind, RepoRef } from '../../shared/forge.ts';
import { readForgeTokens } from '../forges/env.ts';
import type { ForgeHost } from '../forges/forge.ts';
import { HOSTS } from '../forges/registry.ts';
import { HttpError } from '../http/router.ts';
import type { Paths } from '../paths.ts';
import { cloneFolder, listRepos, removeRepo } from '../store/repos.ts';
import type { SpawnInfo } from './exec.ts';
import { GitError, git, gitText } from './exec.ts';
import { resolveCommit } from './repo.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Basic auth needs a user name. Both forges document a fixed placeholder: GitHub accepts any user,
 * GitLab expects `oauth2` for a personal access token.
 */
const AUTH_USERS: Record<ForgeKind, string> = {
  github: 'x-access-token',
  gitlab: 'oauth2',
};

export type CloneOptions = {
  /** Test seam: a local `file://` remote instead of the registry URL derived from `ref`. */
  cloneUrl?: string;
  /** Test seam: observes the clone child process so the token can be checked in the env, not in argv. */
  onSpawn?: (info: SpawnInfo) => void;
};

/** Environment that authenticates git for this repository; an empty object means an anonymous call. */
export async function cloneEnv(paths: Paths, ref: RepoRef): Promise<NodeJS.ProcessEnv> {
  const host = hostFor(ref);
  const token = (await readForgeTokens(paths.envFile)).get(host.tokenEnv);
  if (token === undefined) {
    // Public repositories clone and fetch anonymously; only the user's `.env` can add a token.
    return {};
  }
  const basic = Buffer.from(`${AUTH_USERS[host.kind]}:${token}`, 'utf8').toString('base64');
  // GIT_CONFIG_* is git's command-scope config: it applies to this child only and never lands in a
  // file or in argv.
  return {
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: `http.${host.webUrl}/.extraHeader`,
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${basic}`,
  };
}

/**
 * Clones `ref` into its clone folder through a temporary directory, so a failed clone never leaves a
 * half repository behind. The URL comes from the registry, never from text the user pasted.
 */
export async function cloneRemote(paths: Paths, ref: RepoRef, options: CloneOptions = {}): Promise<void> {
  const host = hostFor(ref);
  const destination = cloneFolder(paths, ref);
  const parent = dirname(destination);
  await mkdir(parent, { recursive: true });
  if (await pathExists(destination)) {
    // Already complete (the only way it exists, thanks to the rename below); nothing to fetch yet.
    return;
  }

  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
  const url = options.cloneUrl ?? `${host.webUrl}/${ref.project}.git`;
  try {
    await git(parent, ['clone', '--bare', '--filter=blob:none', '--no-tags', url, temporary], {
      env: await cloneEnv(paths, ref),
      onSpawn: options.onSpawn,
    });
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw gitHttpError(error);
  }
}

/** Refreshes the branches of a clone. Pull request refs are fetched separately, by number. */
export async function fetchRemote(root: string, env: NodeJS.ProcessEnv = {}): Promise<void> {
  try {
    await gitText(root, ['fetch', '--prune', '--filter=blob:none', 'origin', '+refs/heads/*:refs/heads/*'], { env });
  } catch (error) {
    throw gitHttpError(error);
  }
}

/**
 * Fetches a pull request head into `refs/revu/pr/<n>/head` and returns its commit.
 * The head ref and the number are validated before git sees them; `--no-write-fetch-head` keeps the
 * shared FETCH_HEAD untouched, so concurrent reviews cannot confuse each other.
 */
export async function fetchPullRequest(
  root: string,
  isClone: boolean,
  forgeRef: string,
  number: number,
  baseSha: string | null = null,
  env: NodeJS.ProcessEnv = {},
): Promise<string> {
  if (!Number.isInteger(number) || number <= 0) {
    throw new HttpError(400, 'Pull request number must be a positive integer');
  }
  assertRef(forgeRef);
  const localRef = `refs/revu/pr/${number}/head`;
  const filter = isClone ? ['--filter=blob:none'] : [];
  try {
    await git(root, ['fetch', '--no-write-fetch-head', ...filter, 'origin', `+${forgeRef}:${localRef}`], { env });
    if (baseSha !== null && baseSha !== '' && !(await hasCommit(root, baseSha))) {
      await git(root, ['fetch', '--no-write-fetch-head', ...filter, 'origin', baseSha], { env });
    }
  } catch (error) {
    throw gitHttpError(error);
  }
  return resolveCommit(root, localRef);
}

/** Deletes `refs/revu/pr/*` refs whose number is not in the keep list. */
export async function pruneLocalPrRefs(root: string, keepNumbers: number[]): Promise<number> {
  const keep = new Set(keepNumbers);
  const output = await gitText(root, ['for-each-ref', '--format=%(refname)', 'refs/revu/pr/']);
  let deleted = 0;
  for (const ref of output.split('\n').filter(Boolean)) {
    const match = /^refs\/revu\/pr\/(\d+)\//.exec(ref);
    if (match === null || keep.has(Number(match[1]))) {
      continue;
    }
    await gitText(root, ['update-ref', '-d', ref]);
    deleted += 1;
  }
  return deleted;
}

/** Connected remote repositories with the size of their clone folder. */
export async function listClones(paths: Paths): Promise<CloneInfo[]> {
  const clones: CloneInfo[] = [];
  for (const repo of await listRepos(paths)) {
    if (repo.kind !== 'remote' || repo.remote === null) {
      continue;
    }
    clones.push({
      repoId: repo.id,
      host: repo.remote.host,
      project: repo.remote.project,
      sizeBytes: await folderSize(repo.path),
      lastUsedAt: repo.lastUsedAt,
    });
  }
  return clones;
}

/**
 * Deletes one clone folder and disconnects it. The real path must stay inside `paths.clones`:
 * `repos.json` is a user file, and a tampered entry must not be able to delete an arbitrary folder.
 */
export async function deleteClone(paths: Paths, repoId: string): Promise<void> {
  const repo = (await listRepos(paths)).find((candidate) => candidate.id === repoId);
  if (repo === undefined) {
    throw new HttpError(404, 'Repository is not connected');
  }
  if (repo.kind !== 'remote' || repo.remote === null) {
    throw new HttpError(400, 'Only remote clones can be deleted');
  }

  const base = await realpath(paths.clones).catch(() => resolve(paths.clones));
  const target = await realpath(repo.path).catch(() => resolve(repo.path));
  const offset = relative(base, target);
  if (offset === '' || offset === '..' || offset.startsWith(`..${sep}`) || isAbsolute(offset)) {
    throw new HttpError(400, 'Clone folder is outside the clone directory');
  }

  await rm(target, { recursive: true, force: true });
  await removeRepo(paths, repoId);
}

/** Removes clones not used for `retentionDays`; returns how many were removed. */
export async function pruneClones(paths: Paths, retentionDays: number, now: Date = new Date()): Promise<number> {
  const cutoff = now.getTime() - retentionDays * DAY_MS;
  let removed = 0;
  for (const repo of await listRepos(paths)) {
    if (repo.kind !== 'remote') {
      continue;
    }
    const usedAt = Date.parse(repo.lastUsedAt);
    if (Number.isFinite(usedAt) && usedAt >= cutoff) {
      continue;
    }
    await deleteClone(paths, repo.id);
    removed += 1;
  }
  return removed;
}

/** Error whose message is safe for the UI: git can echo configuration, so header values are scrubbed. */
export function gitHttpError(error: unknown): HttpError {
  if (error instanceof HttpError) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  return new HttpError(502, message.replace(/Authorization: Basic \S+/gi, 'Authorization: Basic [redacted]'));
}

function hostFor(ref: RepoRef): ForgeHost {
  const host = HOSTS.find((candidate) => candidate.host === ref.host);
  if (host === undefined) {
    throw new HttpError(400, `Unknown forge host: ${ref.host}`);
  }
  return host;
}

/** Ref names are placed in a refspec, so reject anything that could be read as an option or escape it. */
function assertRef(ref: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(ref) || ref.includes('..') || ref.includes('@{')) {
    throw new HttpError(400, 'Invalid pull request ref');
  }
}

async function hasCommit(root: string, sha: string): Promise<boolean> {
  if (!/^[0-9a-f]{7,64}$/i.test(sha)) {
    throw new HttpError(400, 'Invalid commit id');
  }
  try {
    await git(root, ['cat-file', '-e', `${sha}^{commit}`]);
    return true;
  } catch (error) {
    if (error instanceof GitError) {
      return false;
    }
    throw error;
  }
}

async function pathExists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

/** Walks a clone folder; symlinks are skipped so a malicious repository cannot inflate or escape it. */
async function folderSize(folder: string): Promise<number> {
  const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
  let total = 0;
  for (const entry of entries) {
    const child = join(folder, entry.name);
    if (entry.isDirectory()) {
      total += await folderSize(child);
    } else if (entry.isFile()) {
      total += await stat(child).then(
        (info) => info.size,
        () => 0,
      );
    }
  }
  return total;
}
