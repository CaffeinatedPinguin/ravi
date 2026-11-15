/** Routes for connecting local folders, repository settings and reading repository facts. */
import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import {
  AddRepoRequestSchema,
  RepoConnectionRequestSchema,
  ScanRequestSchema,
} from '../../shared/api.ts';
import type { ApiConnectionCheck, DirList, Repo, RepoView, TestConnectionResponse } from '../../shared/api.ts';
import type { AppContext } from '../app.ts';
import { readForgeTokens } from '../forges/env.ts';
import { setEnvVar } from '../forges/env-write.ts';
import { forgeFor, hostForName, maskToken, repoTokenEnv, resolveToken } from '../forges/registry.ts';
import { testGitConnection } from '../git/clone.ts';
import { readRepoInfo } from '../git/repo.ts';
import { readRefs } from '../git/refs.ts';
import { HttpError } from '../http/router.ts';
import type { Router } from '../http/router.ts';
import { addRepo, getRepo, listRepos, removeRepo, scanForRepos, setRepoConnection } from '../store/repos.ts';

export function registerRepoRoutes(router: Router, { paths }: AppContext): void {
  router.get('/api/repos', async (): Promise<RepoView[]> => {
    const repos = await listRepos(paths);
    return Promise.all(repos.map((repo) => viewRepo(paths, repo)));
  });

  router.post('/api/repos', async ({ body }) => viewRepo(paths, await addRepo(paths, (await body(AddRepoRequestSchema)).path)));

  router.delete('/api/repos/:id', ({ params }) => removeRepo(paths, params.id ?? ''));

  router.post('/api/repos/scan', async ({ body }) => scanForRepos(resolve((await body(ScanRequestSchema)).path)));

  router.get('/api/repos/:id/info', async ({ params }) => readRepoInfo((await getRepo(paths, params.id ?? '')).path));

  // Feeds the base branch and range pickers; the id is looked up, never used as a path.
  router.get('/api/repos/:id/refs', async ({ params }) => readRefs((await getRepo(paths, params.id ?? '')).path));

  // Connection step of the settings wizard: transport and the token, which never comes back.
  router.put('/api/repos/:id/connection', async ({ params, body }): Promise<RepoView> => {
    const repo = await getRepo(paths, params.id ?? '');
    const input = await body(RepoConnectionRequestSchema);
    if (input.token !== undefined) {
      const name = tokenVariable(repo.remote?.host ?? null, repo.id, input.tokenScope);
      await setEnvVar(paths.envFile, name, input.token);
    }
    const updated = await setRepoConnection(paths, repo.id, { transport: input.transport, tokenScope: input.tokenScope });
    return viewRepo(paths, updated);
  });

  router.post('/api/repos/:id/test-connection', async ({ params }): Promise<TestConnectionResponse> => {
    const repo = await getRepo(paths, params.id ?? '');
    return {
      git: await testGitConnection(paths, repo),
      api: await testApiConnection(paths, repo),
    };
  });

  // Feeds the folder picker: a browser cannot hand a real file system path to the server.
  router.get('/api/fs/dirs', async ({ query }): Promise<DirList> => {
    const path = resolve(query.get('path') || homedir());
    const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
    const dirs = entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && !entry.name.startsWith('$'))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));
    return { path, dirs };
  });
}

/** The `.env` variable a token belongs to, for the scope the user picked. */
export function tokenVariable(host: string | null, repoId: string, scope: 'repo' | 'host'): string {
  if (scope === 'repo') {
    const name = repoTokenEnv(repoId);
    if (name === null) {
      throw new HttpError(400, 'This repository id cannot name a token variable');
    }
    return name;
  }
  const forgeHost = hostForName(host);
  if (forgeHost === undefined) {
    throw new HttpError(400, 'A host token needs a repository with a GitHub or GitLab remote');
  }
  return forgeHost.tokenEnv;
}

/** Stored repository plus token state; values come only from `.env`, the UI sees a four-char hint. */
export async function viewRepo(paths: AppContext['paths'], repo: Repo): Promise<RepoView> {
  const tokens = await readForgeTokens(paths.envFile);
  const host = hostForName(repo.remote?.host);
  const token =
    host === undefined ? undefined : resolveToken(tokens, host.tokenEnv, repo.id, repo.tokenScope);
  return { ...repo, hasToken: token !== undefined, tokenHint: maskToken(token) };
}

/** A repository without a forge remote still works locally; the API half is then simply not set up. */
async function testApiConnection(paths: AppContext['paths'], repo: Repo): Promise<ApiConnectionCheck> {
  if (repo.remote === null) {
    return { ok: false, message: 'This repository has no GitHub or GitLab remote' };
  }
  try {
    const forge = await forgeFor(paths, repo.remote, { repoId: repo.id, tokenScope: repo.tokenScope });
    const user = await forge.currentUser();
    // Listing pull requests is the cheapest proof that the token can read this repository.
    await forge.listPullRequests(repo.remote, { state: 'open' });
    return { ok: true, user, message: `Connected to ${repo.remote.host} as ${user}` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Forge request failed' };
  }
}
