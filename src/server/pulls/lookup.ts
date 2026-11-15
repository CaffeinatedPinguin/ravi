/** Small shared pieces for the pull request routes: remote, forge and number validation. */
import type { Repo } from '../../shared/api.ts';
import type { RepoRef } from '../../shared/forge.ts';
import type { Forge } from '../forges/forge.ts';
import { forgeFor } from '../forges/registry.ts';
import { HttpError } from '../http/router.ts';
import type { Paths } from '../paths.ts';

export const NO_FORGE_REMOTE = 'This repository has no GitHub or GitLab remote';

/** Resolves the forge repository of a connected repo; a local folder without `origin` cannot be used. */
export function requireRemote(repo: Repo): RepoRef {
  if (repo.remote === null) {
    throw new HttpError(400, NO_FORGE_REMOTE);
  }
  return repo.remote;
}

/** Test seam: the real lookup reads the token from `~/.ravi/.env`; tests pass a fake. */
export type ForgeLookup = (repo: Repo) => Promise<Forge>;

export function defaultForgeLookup(paths: Paths): ForgeLookup {
  // The repository id (and its token scope) selects `RAVI_TOKEN_<REPOID>` before the host token.
  return async (repo) =>
    forgeFor(paths, requireRemote(repo), { repoId: repo.id, tokenScope: repo.tokenScope });
}

/** Route parameters are strings; only a positive integer may reach the forge or git. */
export function pullRequestNumber(value: string | undefined): number {
  const number = Number(value ?? '');
  if (!Number.isInteger(number) || number <= 0) {
    throw new HttpError(400, 'Pull request number must be a positive integer');
  }
  return number;
}
