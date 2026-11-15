/**
 * Host registry and facade.
 *
 * Adding a forge is a strategy file plus one entry here; nothing else in the server needs to know
 * that a new kind exists. The token is read only when a strategy is built, and it is handed to the
 * HTTP client as an auth callback, never stored on the strategy object.
 */
import type { ForgeKind, ForgeStatus, RepoRef } from '../../shared/forge.ts';
import type { RepoTokenScope } from '../../shared/api.ts';
import { HttpError } from '../http/router.ts';
import type { Paths } from '../paths.ts';
import { readAsset } from '../review/assets.ts';
import { e2eForgeOverride } from './e2e-override.ts';
import { readForgeTokens } from './env.ts';
import type { Forge, ForgeHost } from './forge.ts';
import { createGitHubForge } from './github.ts';
import { createGitLabForge } from './gitlab.ts';
import type { FetchLike, ForgeHttp } from './http.ts';
import { createForgeHttp } from './http.ts';

export type { ForgeHost } from './forge.ts';

/** Everything a strategy needs beyond its host; the registry binds it to the application paths. */
export type ForgeFactoryContext = {
  http: ForgeHttp;
  /** Adds the host's auth headers to a fresh header set (uploads need this outside `ForgeHttp`). */
  auth: (headers: Headers) => void;
  /** Reads an image from `data/assets`; the strategy only ever sees the asset id. */
  readAsset: (id: string) => Promise<{ data: Uint8Array; type: string }>;
  /** Test seam for the raw multipart fetch; production uses the global fetch. */
  fetchImpl?: FetchLike;
};

/** Builds a strategy for one host; the registry owns the mapping from kind to this function. */
export type ForgeFactory = (host: ForgeHost, context: ForgeFactoryContext) => Forge;

function githubAuth(token: string, headers: Headers): void {
  headers.set('authorization', `Bearer ${token}`);
  // API version shown by the GitHub docs on 2026-11-14.
  headers.set('x-github-api-version', '2026-03-10');
  headers.set('accept', 'application/vnd.github+json');
}

function gitlabAuth(token: string, headers: Headers): void {
  headers.set('private-token', token);
}

const BASE_HOSTS: ForgeHost[] = [
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

/** The E2E harness points the GitHub strategy at its fake loopback API; nothing else changes. */
function hostsForThisProcess(): ForgeHost[] {
  const override = e2eForgeOverride();
  if (override === null) {
    return BASE_HOSTS;
  }
  return BASE_HOSTS.map((host) =>
    host.kind === 'github' ? { ...host, apiUrl: override.apiUrl, webUrl: override.webUrl } : host,
  );
}

export const HOSTS: ForgeHost[] = hostsForThisProcess();

export const FACTORIES: Record<ForgeKind, ForgeFactory> = {
  // GitHub's factory does not need uploads yet; the registry adapts it to the shared context.
  github: (host, context) => createGitHubForge(host, context.http),
  gitlab: (host, context) =>
    createGitLabForge(host, context.http, {
      auth: context.auth,
      readAsset: context.readAsset,
      ...(context.fetchImpl === undefined ? {} : { fetchImpl: context.fetchImpl }),
    }),
};

export type ForgeForOptions = {
  /** Test seam: replace the network for every call made by the returned strategy. */
  fetchImpl?: FetchLike;
  /** Selects the repository token before the host token, exactly like the connection setting. */
  repoId?: string;
  tokenScope?: RepoTokenScope;
};

/**
 * Name of the `~/.revu/.env` variable that holds a repository's own token.
 * Ids are lowercase hex; anything else cannot have been assigned by revu, so it gets no name.
 */
export function repoTokenEnv(repoId: string): string | null {
  if (!/^[a-z0-9]{1,52}$/i.test(repoId)) {
    return null;
  }
  return `REVU_TOKEN_${repoId.toUpperCase()}`;
}

/** Only the last four characters ever leave the server, and a short token stays fully hidden. */
export function maskToken(token: string | undefined): string | null {
  if (token === undefined || token === '') {
    return null;
  }
  return token.length > 4 ? `••••${token.slice(-4)}` : '••••';
}

/**
 * Repository token first, then the host token. `tokenScope === 'host'` is the explicit
 * "use the host token for this repository" choice and therefore skips the repository variable.
 */
export function resolveToken(
  tokens: Map<string, string>,
  hostTokenEnv: string,
  repoId?: string,
  tokenScope?: RepoTokenScope,
): string | undefined {
  if (repoId !== undefined && tokenScope !== 'host') {
    const name = repoTokenEnv(repoId);
    if (name !== null) {
      const repositoryToken = tokens.get(name);
      if (repositoryToken !== undefined) {
        return repositoryToken;
      }
    }
  }
  return tokens.get(hostTokenEnv);
}

/** Host entry for a name; a URL from the user may name a host that is not registered. */
export function hostForName(name: string | null | undefined): ForgeHost | undefined {
  return HOSTS.find((candidate) => candidate.host === name);
}

/**
 * The facade every caller uses. Unknown hosts and missing tokens are request errors: the UI shows
 * them next to the repository, and no strategy is built without credentials.
 */
export async function forgeFor(paths: Paths, repo: RepoRef, options: ForgeForOptions = {}): Promise<Forge> {
  const host = hostForName(repo.host);
  if (host === undefined) {
    throw new HttpError(400, `Unknown forge host: ${repo.host}`);
  }

  const token = resolveToken(
    await readForgeTokens(paths.envFile),
    host.tokenEnv,
    options.repoId,
    options.tokenScope,
  );
  if (token === undefined) {
    throw new HttpError(401, `No token for ${host.host}: add ${host.tokenEnv} to ~/.revu/.env`);
  }

  const auth = (headers: Headers): void => host.auth(token, headers);
  const http = createForgeHttp({
    apiUrl: host.apiUrl,
    auth,
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
  });
  return FACTORIES[host.kind](host, {
    http,
    auth,
    readAsset: (id) => readAsset(paths, id),
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
  });
}

/** Reports which hosts have a token; the token value is never part of the answer. */
export async function forgeStatus(paths: Paths): Promise<Array<ForgeStatus & { tokenHint: string | null }>> {
  const tokens = await readForgeTokens(paths.envFile);
  return HOSTS.map((host) => {
    const token = tokens.get(host.tokenEnv);
    return {
      host: host.host,
      kind: host.kind,
      hasToken: token !== undefined,
      tokenHint: maskToken(token),
      webUrl: host.webUrl,
    };
  });
}
