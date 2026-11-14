/**
 * The Send route: the only place in the server that writes comments to a forge.
 *
 * Reading a review never talks to the forge; this route reloads the stored document, asks the forge
 * for the current pull request, refuses a stale head unless forced, then sends the drafts as
 * operations and mirrors the outcome back into the document (sent drafts disappear, failed ones keep
 * a `sendError` for a retry). Every send appends one line to `data/send-log.jsonl`; bodies are never
 * logged, only counts, so the log can prove that writes happen only here.
 */
import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { DiffTarget, Patches } from '../../shared/api.ts';
import type { DraftOperation, SubmitResult } from '../../shared/forge.ts';
import { ReviewActionSchema, SubmitResultSchema } from '../../shared/forge.ts';
import type { ReviewComment, ReviewDocument } from '../../shared/review.ts';
import { ReviewDocumentSchema } from '../../shared/review.ts';
import type { AppContext } from '../app.ts';
import { diffPatches, diffSummary } from '../git/diff.ts';
import { HttpError } from '../http/router.ts';
import type { Router } from '../http/router.ts';
import type { Paths } from '../paths.ts';
import { forgeCall } from '../pulls/errors.ts';
import { defaultForgeLookup, pullRequestNumber, requireRemote } from '../pulls/lookup.ts';
import type { ForgeLookup } from '../pulls/lookup.ts';
import { buildOperations } from '../review/outbox.ts';
import { readReview, writeReview } from '../review/store.ts';
import { getRepo } from '../store/repos.ts';

const HEAD_CHANGED = 'The pull request changed since you opened it. Reload, or send anyway.';

export const SendRequestSchema = z.object({
  /** Review-level verdict sent with the drafts; null sends the comments alone. */
  action: ReviewActionSchema.nullable().default(null),
  /** Review-level summary text; null when there is none. */
  summary: z.string().nullable().default(null),
  /** Send even when the pull request head moved since the review was opened. */
  force: z.boolean().default(false),
});
export type SendRequest = z.infer<typeof SendRequestSchema>;

export const SendResponseSchema = z.object({
  results: z.array(SubmitResultSchema),
  document: ReviewDocumentSchema,
});
export type SendResponse = { results: SubmitResult[]; document: ReviewDocument };

export type SendDependencies = {
  /** Builds the forge strategy; tests replace it so no request leaves the process. */
  forgeFor: ForgeLookup;
  /** Test seam for `diffPatches`; production reads the temporary repository. */
  readPatches: typeof diffPatches;
};

export function defaultSendDependencies(paths: Paths): SendDependencies {
  return { forgeFor: defaultForgeLookup(paths), readPatches: diffPatches };
}

export function registerSendRoutes(
  router: Router,
  { paths }: AppContext,
  overrides: Partial<SendDependencies> = {},
): void {
  router.post('/api/repos/:id/pulls/:number/send', async ({ params, body }) => {
    const request = await body(SendRequestSchema);
    return sendReview(paths, params.id ?? '', pullRequestNumber(params.number), request, overrides);
  });
}

export async function sendReview(
  paths: Paths,
  repoId: string,
  number: number,
  request: SendRequest,
  overrides: Partial<SendDependencies> = {},
): Promise<SendResponse> {
  const deps = { ...defaultSendDependencies(paths), ...overrides };
  const repo = await getRepo(paths, repoId);
  const remote = requireRemote(repo);
  const forge = await deps.forgeFor(repo);
  const target = { kind: 'pullRequest' as const, host: remote.host, project: remote.project, number, forge: forge.kind };

  const pullRequest = await forgeCall(() => forge.getPullRequest(remote, number));
  const document = await readReview(paths, repoId, target);

  if (!request.force && (document.headSha === null || document.headSha !== pullRequest.headSha)) {
    throw new HttpError(409, HEAD_CHANGED);
  }

  const operations = buildOperations(document, await patchesFor(repo.path, pullRequest, document, deps.readPatches));
  // A forge-level failure (no token, 401/403/5xx) arrives before any result: the document stays as
  // it was, so nothing is lost and the user can retry.
  const results = await forgeCall(() => forge.submit(remote, number, pullRequest, operations, request.action, request.summary));

  const updated = applyResults(document, operations, results);
  await writeReview(paths, repoId, updated);
  await appendSendLog(paths, repoId, number, request.action, operations, results);
  return { results, document: updated };
}

/**
 * Patches for the files that carry inline comments. Without them the forge could not place a
 * context line on both sides, so only the files that are actually commented are requested.
 */
async function patchesFor(
  root: string,
  pullRequest: { baseSha: string; headSha: string },
  document: ReviewDocument,
  readPatches: typeof diffPatches,
): Promise<Patches> {
  const wanted = new Set<string>();
  for (const comment of document.comments) {
    if (
      comment.state === 'draft' &&
      (comment.pendingAction ?? null) === null &&
      (comment.remoteThreadId ?? null) === null &&
      comment.path !== null &&
      comment.line !== null
    ) {
      wanted.add(comment.path);
    }
  }
  if (wanted.size === 0) {
    return {};
  }

  const target: DiffTarget = { kind: 'range', from: pullRequest.baseSha, to: pullRequest.headSha, mergeBase: true };
  const summary = await diffSummary(root, { target, ignoreWhitespace: false, includeUntracked: false });
  const files = summary.files
    .filter((file) => wanted.has(file.path) || (file.oldPath !== null && wanted.has(file.oldPath)))
    .map((file) => ({ path: file.path, oldPath: file.oldPath, status: file.status }));
  if (files.length === 0) {
    return {};
  }
  return readPatches(root, { target, ignoreWhitespace: false, includeUntracked: false, files });
}

/**
 * Mirrors the per-draft results into the document. A folded local reply has no operation of its
 * own, so it shares the outcome of the draft it was folded into.
 */
function applyResults(document: ReviewDocument, operations: DraftOperation[], results: SubmitResult[]): ReviewDocument {
  const byDraft = new Map(results.map((result) => [result.draftId, result]));
  const operationIds = new Set(operations.map((operation) => operation.draftId));
  const owners = ownerByDraft(document, operationIds);
  const allSucceeded = operations.length === results.length && results.every((result) => result.ok);

  const comments = document.comments.flatMap((comment): ReviewComment[] => {
    if (comment.state !== 'draft') {
      return [comment];
    }
    const owner = owners.get(comment.id);
    if (owner === undefined) {
      return [comment];
    }
    const result = byDraft.get(owner);
    if (result === undefined) {
      return [{ ...comment, sendError: 'The forge did not report a result for this comment' }];
    }
    if (result.ok) {
      return [];
    }
    return [{ ...comment, sendError: result.error ?? 'The forge rejected this comment' }];
  });

  return {
    ...document,
    comments,
    // The summary/action are only "sent" when every operation went through; otherwise the user
    // retries and the forge must not receive the same verdict twice.
    action: allSucceeded ? null : document.action,
    summary: allSucceeded ? null : document.summary,
  };
}

/** Maps each draft to the nearest draft that owns an operation (itself for a top-level draft). */
function ownerByDraft(document: ReviewDocument, operationIds: Set<string>): Map<string, string> {
  const drafts = new Map(document.comments.filter((comment) => comment.state === 'draft').map((comment) => [comment.id, comment]));
  const owners = new Map<string, string>();

  for (const id of drafts.keys()) {
    let current = id;
    const seen = new Set<string>();
    while (!operationIds.has(current) && !seen.has(current)) {
      seen.add(current);
      const parent = drafts.get(current)?.parentId ?? null;
      if (parent === null) {
        break;
      }
      current = parent;
    }
    if (operationIds.has(current)) {
      owners.set(id, current);
    }
  }
  return owners;
}

async function appendSendLog(
  paths: Paths,
  repoId: string,
  number: number,
  action: SendRequest['action'],
  operations: DraftOperation[],
  results: SubmitResult[],
): Promise<void> {
  const counts = { comment: 0, reply: 0, prComment: 0, edit: 0, delete: 0 };
  for (const operation of operations) {
    counts[operation.op] += 1;
  }
  const line = JSON.stringify({
    time: new Date().toISOString(),
    repoId,
    number,
    action,
    operations: counts,
    outcomes: { ok: results.filter((result) => result.ok).length, failed: results.filter((result) => !result.ok).length },
  });
  await mkdir(paths.data, { recursive: true });
  // Append-only: one line per send, no bodies and no tokens, so it is safe to keep forever.
  await appendFile(join(paths.data, 'send-log.jsonl'), `${line}\n`, { mode: 0o600 });
}
