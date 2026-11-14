/**
 * One JSON file per review, kept next to the app data.
 *
 * The file name is derived from the target because the URL never carries a path to app data: the UI
 * names a target and the server maps it to a stable key. Local targets are hashed (they can be any
 * absolute path), pull requests are readable so an export can be found by hand.
 */
import { join } from 'node:path';
import { ReviewDocumentSchema } from '../../shared/review.ts';
import type { ReviewDocument, ReviewTarget } from '../../shared/review.ts';
import type { Paths } from '../paths.ts';
import { readJsonFile, writeJsonFile } from '../store/json-file.ts';

/** Repository ids come from `repoId()` in `store/repos.ts`; anything else would be a path escape. */
const REPO_ID = /^[a-f0-9]{8,64}$/;

export function reviewKey(target: ReviewTarget): string {
  if (target.kind === 'local') {
    return `local-${fnv1a16(`${target.repoPath}\0${target.target}`)}`;
  }
  return `${target.forge}-${safeName(target.host)}-${safeName(target.project)}-${target.number}`;
}

export function emptyReview(target: ReviewTarget): ReviewDocument {
  return { version: 1, target, baseSha: null, headSha: null, action: null, summary: null, comments: [] };
}

export async function readReview(paths: Paths, repoId: string, target: ReviewTarget): Promise<ReviewDocument> {
  return readJsonFile(reviewFile(paths, repoId, target), ReviewDocumentSchema, emptyReview(target));
}

export async function writeReview(paths: Paths, repoId: string, doc: ReviewDocument): Promise<void> {
  await writeJsonFile(reviewFile(paths, repoId, doc.target), doc);
}

function reviewFile(paths: Paths, repoId: string, target: ReviewTarget): string {
  assertRepoId(repoId);
  return join(paths.data, 'reviews', repoId, `${reviewKey(target)}.json`);
}

function assertRepoId(repoId: string): void {
  if (!REPO_ID.test(repoId)) {
    throw new Error('Invalid repository id');
  }
}

/**
 * A host and a project are free text; a file name is not. Replace `/` with `__` first so a project
 * path stays readable, then everything outside the safe set (including `\`). Runs of dots are
 * flattened too: `..` never comes from a slash here, but a project may literally contain it.
 */
function safeName(value: string): string {
  return value
    .replaceAll('/', '__')
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/\.{2,}/g, (dots) => '_'.repeat(dots.length));
}

/** FNV-1a, 64-bit, written as 16 hex characters so the name is fixed width. */
function fnv1a16(input: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(input)) {
    hash ^= BigInt(byte);
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, '0');
}
