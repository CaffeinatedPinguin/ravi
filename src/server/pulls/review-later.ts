/**
 * The "review later" list: pull requests the user wants to come back to.
 *
 * The file is a cache of forge metadata, not a source of truth: an entry survives a forge outage
 * with its previous `lastKnown`, and the derived flags are always computed from that cache.
 */
import { join } from 'node:path';
import {
  ReviewLaterEntrySchema,
  ReviewLaterStoredSchema,
} from '../../shared/api.ts';
import type { ReviewLaterAddRequest, ReviewLaterEntry, ReviewLaterStored } from '../../shared/api.ts';
import type { Forge } from '../forges/forge.ts';
import { HttpError } from '../http/router.ts';
import { getRepo, listRepos } from '../store/repos.ts';
import { readJsonFile, writeJsonFile } from '../store/json-file.ts';
import type { Paths } from '../paths.ts';
import { defaultForgeLookup, requireRemote } from './lookup.ts';
import type { ForgeLookup } from './lookup.ts';

const StoreSchema = ReviewLaterStoredSchema.array();
/** At most this many forge calls run at once; a long list must not burst the API's rate limit. */
const REFRESH_CONCURRENCY = 4;

export type ReviewLaterOptions = {
  /** Test seam; the default reads `repo.remote` and builds the real strategy. */
  forgeFor?: ForgeLookup;
};

const file = (paths: Paths): string => join(paths.data, 'review-later.json');

export async function listReviewLater(paths: Paths): Promise<ReviewLaterEntry[]> {
  return (await readStored(paths)).map(withDerived);
}

/** Adds one pull request; adding the same pair again is a no-op and answers with the existing entry. */
export async function addReviewLater(
  paths: Paths,
  request: ReviewLaterAddRequest,
  options: ReviewLaterOptions = {},
): Promise<ReviewLaterEntry> {
  const repo = await getRepo(paths, request.repoId);
  const remote = requireRemote(repo);
  const forge = await (options.forgeFor ?? defaultForgeLookup(paths))(repo);
  const pullRequest = await forge.getPullRequest(remote, request.number);

  const stored = await readStored(paths);
  const existing = stored.find((entry) => entry.repoId === request.repoId && entry.number === request.number);
  if (existing !== undefined) {
    return withDerived(existing);
  }

  const entry: ReviewLaterStored = {
    repoId: request.repoId,
    number: request.number,
    title: pullRequest.title,
    addedAt: new Date().toISOString(),
    headShaAtAdd: pullRequest.headSha,
    lastKnown: null,
  };
  await writeStored(paths, [...stored, entry]);
  return withDerived(entry);
}

export async function removeReviewLater(paths: Paths, repoId: string, number: number): Promise<void> {
  const stored = await readStored(paths);
  await writeStored(
    paths,
    stored.filter((entry) => entry.repoId !== repoId || entry.number !== number),
  );
}

/** Checks every entry against the forge; a failing entry keeps its previous `lastKnown` and gets `error`. */
export async function refreshReviewLater(
  paths: Paths,
  options: ReviewLaterOptions = {},
): Promise<ReviewLaterEntry[]> {
  const stored = await readStored(paths);
  if (stored.length === 0) {
    return [];
  }

  const repoById = new Map((await listRepos(paths)).map((repo) => [repo.id, repo]));
  const forges = new Map<string, Promise<Forge>>();
  const forgeFor = options.forgeFor ?? defaultForgeLookup(paths);
  const checked: ReviewLaterStored[] = stored.map((entry) => ({ ...entry }));
  const errors = new Map<number, string>();
  const checkedAt = new Date().toISOString();

  await inParallel(
    stored.map((_, index) => index),
    REFRESH_CONCURRENCY,
    async (index) => {
      const entry = stored[index];
      if (entry === undefined) {
        return;
      }
      try {
        const repo = repoById.get(entry.repoId);
        if (repo === undefined) {
          throw new HttpError(404, 'Repository is not connected');
        }
        const remote = requireRemote(repo);
        let pending = forges.get(entry.repoId);
        if (pending === undefined) {
          pending = forgeFor(repo);
          forges.set(entry.repoId, pending);
        }
        const forge = await pending;
        const pullRequest = await forge.getPullRequest(remote, entry.number);
        checked[index] = {
          ...entry,
          lastKnown: {
            headSha: pullRequest.headSha,
            state: pullRequest.state,
            updatedAt: pullRequest.updatedAt,
            checkedAt,
          },
        };
      } catch (error) {
        errors.set(index, error instanceof Error ? error.message : 'Could not check the pull request');
      }
    },
  );

  await writeStored(paths, checked);
  return checked.map((entry, index) => {
    const derived = withDerived(entry);
    const error = errors.get(index);
    return error === undefined ? derived : { ...derived, error };
  });
}

function withDerived(entry: ReviewLaterStored): ReviewLaterEntry {
  return ReviewLaterEntrySchema.parse({
    ...entry,
    changedSinceAdded: entry.lastKnown !== null && entry.lastKnown.headSha !== entry.headShaAtAdd,
    closed: entry.lastKnown !== null && entry.lastKnown.state !== 'open',
  });
}

async function readStored(paths: Paths): Promise<ReviewLaterStored[]> {
  return readJsonFile(file(paths), StoreSchema, []);
}

async function writeStored(paths: Paths, entries: ReviewLaterStored[]): Promise<void> {
  await writeJsonFile(file(paths), entries);
}

/** Runs `task` over `items` with a fixed number of workers; order does not matter to the caller. */
async function inParallel<T>(items: readonly T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next;
      next += 1;
      const item = items[index];
      if (item === undefined) {
        return;
      }
      await task(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
