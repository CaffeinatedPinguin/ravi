/**
 * Host registry and facade.
 *
 * Adding a forge is a strategy file plus one entry here; nothing else in the server needs to know
 * that a new kind exists. The token is read only when a strategy is built, and it is handed to the
 * HTTP client as an auth callback, never stored on the strategy object.
 */
import type { ForgeKind, ForgeStatus, RepoRef } from '../../shared/forge.ts';
import { HttpError } from '../http/router.ts';
import type { Paths } from '../paths.ts';
import { readForgeTokens } from './env.ts';
import type { Forge, ForgeFactory, ForgeHost } from './forge.ts';
import { createGitHubForge } from './github.ts';
import { createGitLabForge } from './gitlab.ts';
import { createForgeHttp } from './http.ts';

export type { ForgeFactory, ForgeHost } from './forge.ts';

function githubAuth(token: string, headers: Headers): void {
  headers.set('authorization', `Bearer ${token}`);
  headers.set('x-github-api-version', '2022-11-28');
  headers.set('accept', 'application/vnd.github+json');
}

function gitlabAuth(token: string, headers: Headers): void {
  headers.set('private-token', token);
}

export const HOSTS: ForgeHost[] = [
  {
    host: 'github.com',
    kind: 'github',
    apiUrl: 'https://api.github.com',
    webUrl: 'https://github.com',
    tokenEnv: 'GITHUB_TOKEN',
    auth: githubAuth,
  },
  {
    host: 'gitlab.com',
    kind: 'gitlab',
    apiUrl: 'https://gitlab.com/api/v4',
    webUrl: 'https://gitlab.com',
    tokenEnv: 'GITLAB_TOKEN',
    auth: gitlabAuth,
  },
];

export const FACTORIES: Record<ForgeKind, ForgeFactory> = {
  github: createGitHubForge,
  gitlab: createGitLabForge,
};

/**
 * The facade every caller uses. Unknown hosts and missing tokens are request errors: the UI shows
 * them next to the repository, and no strategy is built without credentials.
 */
export async function forgeFor(paths: Paths, repo: RepoRef): Promise<Forge> {
  const host = HOSTS.find((candidate) => candidate.host === repo.host);
  if (host === undefined) {
    throw new HttpError(400, `Unknown forge host: ${repo.host}`);
  }

  const token = (await readForgeTokens(paths.envFile)).get(host.tokenEnv);
  if (token === undefined) {
    throw new HttpError(401, `No token for ${host.host}: add ${host.tokenEnv} to ~/.revu/.env`);
  }

  const http = createForgeHttp({
    apiUrl: host.apiUrl,
    auth: (headers) => host.auth(token, headers),
  });
  return FACTORIES[host.kind](host, http);
}

/** Reports which hosts have a token; the token value is never part of the answer. */
export async function forgeStatus(paths: Paths): Promise<ForgeStatus[]> {
  const tokens = await readForgeTokens(paths.envFile);
  return HOSTS.map((host) => ({
    host: host.host,
    kind: host.kind,
    hasToken: tokens.has(host.tokenEnv),
    webUrl: host.webUrl,
  }));
}
