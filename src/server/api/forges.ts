/** Forge routes: host status, token reload and the remote detected for a connected repository. */
import type { RepoRef, ForgeStatus } from '../../shared/forge.ts';
import type { AppContext } from '../app.ts';
import { reloadForgeTokens } from '../forges/env.ts';
import { forgeStatus } from '../forges/registry.ts';
import { detectRepoRef } from '../forges/remote.ts';
import type { Router } from '../http/router.ts';
import { getRepo } from '../store/repos.ts';

export function registerForgeRoutes(router: Router, { paths }: AppContext): void {
  router.get('/api/forges', (): Promise<ForgeStatus[]> => forgeStatus(paths));

  router.post('/api/forges/reload', (): Promise<ForgeStatus[]> => {
    reloadForgeTokens();
    return forgeStatus(paths);
  });

  router.get('/api/repos/:id/remote', async ({ params }): Promise<RepoRef | null> => {
    const repo = await getRepo(paths, params.id ?? '');
    return detectRepoRef(repo.path);
  });
}
