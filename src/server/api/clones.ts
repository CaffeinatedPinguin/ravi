/** Routes for remote repositories: connect by URL, refresh, fetch pull request heads, manage clones. */
import { AddRemoteRepoRequestSchema } from '../../shared/api.ts';
import type { CloneInfo, FetchResponse, PullRequestFetchResponse, Repo, RepoView } from '../../shared/api.ts';
import type { RepoRef } from '../../shared/forge.ts';
import type { AppContext } from '../app.ts';
import { createForgeHttp } from '../forges/http.ts';
import { setEnvVar } from '../forges/env-write.ts';
import { FACTORIES, HOSTS } from '../forges/registry.ts';
import { parseRemoteUrl } from '../forges/remote.ts';
import { cloneEnv, cloneRemote, deleteClone, fetchPullRequest, fetchRemote, gitHttpError, listClones } from '../git/clone.ts';
import { gitText } from '../git/exec.ts';
import { HttpError } from '../http/router.ts';
import type { Router } from '../http/router.ts';
import {
  addRemoteRepo,
  getRepo,
  listRepos,
  remoteRepoId,
  setRepoConnection,
  touchRepo,
} from '../store/repos.ts';
import { tokenVariable, viewRepo } from './repos.ts';

export function registerCloneRoutes(router: Router, { paths }: AppContext): void {
  router.post('/api/repos/remote', async ({ body }): Promise<RepoView> => {
    const input = await body(AddRemoteRepoRequestSchema);
    const ref = parseRemoteUrl(input.url);
    if (ref === null) {
      throw new HttpError(400, 'Not a supported repository URL');
    }
    if (!HOSTS.some((host) => host.host === ref.host)) {
      throw new HttpError(400, `Unsupported forge host: ${ref.host}`);
    }

    const existing = (await listRepos(paths)).find((repo) => repo.kind === 'remote' && sameRepo(repo.remote, ref));
    if (existing !== undefined) {
      if (input.token !== undefined) {
        await setEnvVar(paths.envFile, tokenVariable(ref.host, existing.id, input.tokenScope), input.token);
      }
      const updated = await setRepoConnection(paths, existing.id, {
        transport: input.transport,
        tokenScope: input.tokenScope,
      });
      return viewRepo(paths, updated);
    }

    // The clone itself needs the credentials, so the token must be in `.env` before `git clone`.
    const id = remoteRepoId(paths, ref);
    if (input.token !== undefined) {
      await setEnvVar(paths.envFile, tokenVariable(ref.host, id, input.tokenScope), input.token);
    }
    await cloneRemote(paths, ref, { transport: input.transport, repoId: id, tokenScope: input.tokenScope });
    const repo = await addRemoteRepo(paths, ref, { transport: input.transport, tokenScope: input.tokenScope });
    return viewRepo(paths, repo);
  });

  router.post('/api/repos/:id/fetch', async ({ params }): Promise<FetchResponse> => {
    const repo = await getRepo(paths, params.id ?? '');
    const env = await envFor(paths, repo);
    if (repo.kind === 'remote' && repo.remote !== null) {
      await fetchRemote(repo.path, env);
    } else if (repo.transport === 'https' && repo.remote !== null) {
      // A local folder with an HTTPS transport may need a token, exactly like a clone.
      try {
        await gitText(repo.path, ['fetch', '--prune', 'origin'], { env });
      } catch (error) {
        throw gitHttpError(error);
      }
    } else {
      try {
        // Local folders use the user's own git credentials; only remote-tracking refs are updated.
        await gitText(repo.path, ['fetch', '--prune', 'origin']);
      } catch (error) {
        throw gitHttpError(error);
      }
    }
    await touchRepo(paths, repo.id);
    return { fetchedAt: new Date().toISOString() };
  });

  router.post('/api/repos/:id/pulls/:number/fetch', async ({ params }): Promise<PullRequestFetchResponse> => {
    const repo = await getRepo(paths, params.id ?? '');
    const remote = repo.remote;
    if (remote === null) {
      throw new HttpError(400, 'Repository has no forge remote');
    }
    const number = Number(params.number ?? '');
    if (!Number.isInteger(number) || number <= 0) {
      throw new HttpError(400, 'Pull request number must be a positive integer');
    }
    const forgeRef = pullRequestRef(remote, number);
    const env = await envFor(paths, repo);
    const headSha = await fetchPullRequest(repo.path, repo.kind === 'remote', forgeRef, number, null, env);
    await touchRepo(paths, repo.id);
    return { headSha };
  });

  router.get('/api/clones', (): Promise<CloneInfo[]> => listClones(paths));

  router.delete('/api/clones/:repoId', async ({ params }) => {
    await deleteClone(paths, params.repoId ?? '');
  });
}

/** SSH never sees a token; HTTPS uses the repository token first, then the host token. */
function envFor(paths: AppContext['paths'], repo: Repo): Promise<NodeJS.ProcessEnv> {
  return cloneEnv(paths, repo.remote, {
    transport: repo.transport,
    repoId: repo.id,
    tokenScope: repo.tokenScope,
  });
}

function sameRepo(remote: RepoRef | null, ref: RepoRef): boolean {
  return remote !== null && remote.host === ref.host && remote.project === ref.project;
}

/**
 * `pullRequestRef` is pure (it only formats a string), so a tokenless strategy is enough here:
 * fetching a head of a public pull request must work without credentials.
 */
function pullRequestRef(ref: RepoRef, number: number): string {
  const host = HOSTS.find((candidate) => candidate.host === ref.host);
  if (host === undefined) {
    throw new HttpError(400, `Unknown forge host: ${ref.host}`);
  }
  const forge = FACTORIES[host.kind](host, {
    http: createForgeHttp({ apiUrl: host.apiUrl, auth: () => undefined }),
    auth: () => undefined,
    // Formatting a ref never touches assets; fail loudly if a strategy ever tries.
    readAsset: () => Promise.reject(new Error('Assets are not available here')),
  });
  return forge.pullRequestRef(number);
}
