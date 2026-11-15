/** Forge routes: host status, host tokens, token reload and the remote detected for a connected repository. */
import { ForgeTokenRequestSchema } from '../../shared/api.ts';
import type { ForgeStatusView } from '../../shared/api.ts';
import type { RepoRef } from '../../shared/forge.ts';
import type { AppContext } from '../app.ts';
import { reloadForgeTokens, readForgeTokens } from '../forges/env.ts';
import { setEnvVar } from '../forges/env-write.ts';
import { forgeStatus, hostForName, maskToken } from '../forges/registry.ts';
import { detectRepoRef } from '../forges/remote.ts';
import { HttpError } from '../http/router.ts';
import type { Router } from '../http/router.ts';
import { getRepo } from '../store/repos.ts';

export function registerForgeRoutes(router: Router, { paths }: AppContext): void {
  router.get('/api/forges', (): Promise<ForgeStatusView[]> => forgeStatus(paths));

  router.post('/api/forges/reload', (): Promise<ForgeStatusView[]> => {
    reloadForgeTokens();
    return forgeStatus(paths);
  });

  // Accounts section: set, replace or remove one host token. The value never comes back.
  router.put('/api/forges/:host/token', async ({ params, body }): Promise<ForgeStatusView> => {
    const host = hostForName(params.host);
    if (host === undefined) {
      throw new HttpError(400, `Unknown forge host: ${params.host ?? ''}`);
    }
    const { token } = await body(ForgeTokenRequestSchema);
    await setEnvVar(paths.envFile, host.tokenEnv, token);
    const stored = (await readForgeTokens(paths.envFile)).get(host.tokenEnv);
    return {
      host: host.host,
      kind: host.kind,
      hasToken: stored !== undefined,
      tokenHint: maskToken(stored),
      webUrl: host.webUrl,
    };
  });

  router.get('/api/repos/:id/remote', async ({ params }): Promise<RepoRef | null> => {
    const repo = await getRepo(paths, params.id ?? '');
    return detectRepoRef(repo.path);
  });
}
