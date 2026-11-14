/** Routes for remote repositories: connect by URL, refresh, fetch pull request heads, manage clones. */
import { AddRemoteRepoRequestSchema } from '../../shared/api.ts';
import type { CloneInfo, FetchResponse, PullRequestFetchResponse } from '../../shared/api.ts';
import type { RepoRef } from '../../shared/forge.ts';
import type { AppContext } from '../app.ts';
import { createForgeHttp } from '../forges/http.ts';
import { FACTORIES, HOSTS } from '../forges/registry.ts';
import { parseRemoteUrl } from '../forges/remote.ts';
import { cloneEnv, cloneRemote, deleteClone, fetchPullRequest, fetchRemote, gitHttpError, listClones } from '../git/clone.ts';
import { gitText } from '../git/exec.ts';
import { HttpError } from '../http/router.ts';
import type { Router } from '../http/router.ts';
import { addRemoteRepo, getRepo, listRepos, touchRepo } from '../store/repos.ts';

export function registerCloneRoutes(router: Router, { paths }: AppContext): void {
  router.post('/api/repos/remote', async ({ body }) => {
    const { url } = await body(AddRemoteRepoRequestSchema);
    const ref = parseRemoteUrl(url);
    if (ref === null) {
      throw new HttpError(400, 'Not a supported repository URL');
    }
    if (!HOSTS.some((host) => host.host === ref.host)) {
      throw new HttpError(400, `Unsupported forge host: ${ref.host}`);
    }

    // Connecting the same repository again only refreshes its use time; re-cloning would be wasted work.
    const existing = (await listRepos(paths)).find((repo) => repo.kind === 'remote' && sameRepo(repo.remote, ref));
    if (existing !== undefined) {
      return touchRepo(paths, existing.id);
    }
    await cloneRemote(paths, ref);
    return addRemoteRepo(paths, ref);
  });

  router.post('/api/repos/:id/fetch', async ({ params }): Promise<FetchResponse> => {
    const repo = await getRepo(paths, params.id ?? '');
    if (repo.kind === 'remote' && repo.remote !== null) {
      await fetchRemote(repo.path, await cloneEnv(paths, repo.remote));
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
    const env = repo.kind === 'remote' ? await cloneEnv(paths, remote) : {};
    const headSha = await fetchPullRequest(repo.path, repo.kind === 'remote', forgeRef, number, null, env);
    await touchRepo(paths, repo.id);
    return { headSha };
  });

  router.get('/api/clones', (): Promise<CloneInfo[]> => listClones(paths));

  router.delete('/api/clones/:repoId', async ({ params }) => {
    await deleteClone(paths, params.repoId ?? '');
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
  const forge = FACTORIES[host.kind](host, createForgeHttp({ apiUrl: host.apiUrl, auth: () => undefined }));
  return forge.pullRequestRef(number);
}
