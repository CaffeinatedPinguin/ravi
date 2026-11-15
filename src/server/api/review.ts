/** Routes for review documents: load, save, Markdown export/import and the attached images. */
import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';
import { isAbsolute, join, resolve } from 'node:path';
import {
  AssetUploadRequestSchema,
  ReviewExportRequestSchema,
  ReviewImportRequestSchema,
  ReviewLoadRequestSchema,
  ReviewSaveRequestSchema,
} from '../../shared/api.ts';
import type { AssetUploadResponse, DiffFile, DiffTarget } from '../../shared/api.ts';
import type { CommentSide, ImportError, ImportedComment, ReviewComment, ReviewDocument, ReviewTarget } from '../../shared/review.ts';
import type { AppContext } from '../app.ts';
import { diffSummary, readBlobLines } from '../git/diff.ts';
import { HttpError, raw } from '../http/router.ts';
import type { Router } from '../http/router.ts';
import type { Paths } from '../paths.ts';
import { importLocalImage, readAsset, saveAsset } from '../review/assets.ts';
import { fromMarkdown, toMarkdown } from '../review/markdown.ts';
import { commentPositions, mergeImported } from '../review/merge.ts';
import type { CommentPosition } from '../review/merge.ts';
import { readReview, writeReview } from '../review/store.ts';
import { getRepo } from '../store/repos.ts';

/** Fixed, so it is impossible to build a pattern from imported text. */
const ASSET_LINK = /asset:([a-f0-9]{64}\.(?:png|jpg|gif|webp))/g;
const IMAGE_LINK = /!\[([^\]]*)\]\(([^)\s]+)\)/g;
/** More than this many lines of context makes an export unreadable; the contract says 20. */
const MAX_CONTEXT_LINES = 20;

export function registerReviewRoutes(router: Router, { paths }: AppContext): void {
  const repoRoot = async (repoId: string): Promise<string> => (await getRepo(paths, repoId)).path;

  router.post('/api/reviews/load', async ({ body }) => {
    const request = await body(ReviewLoadRequestSchema);
    await getRepo(paths, request.repoId);
    return readReview(paths, request.repoId, request.target);
  });

  router.post('/api/reviews/save', async ({ body }) => {
    const request = await body(ReviewSaveRequestSchema);
    assertTargetBelongsToRepo(request.document.target, await repoRoot(request.repoId));
    await writeReview(paths, request.repoId, request.document);
    return request.document;
  });

  router.post('/api/reviews/export', async ({ body }) => {
    const request = await body(ReviewExportRequestSchema);
    const markdown = await exportMarkdown(paths, await repoRoot(request.repoId), request.diffTarget, request.document);
    return { markdown };
  });

  router.post('/api/reviews/import', async ({ body }) => {
    const request = await body(ReviewImportRequestSchema);
    return importMarkdown(paths, await repoRoot(request.repoId), request.diffTarget, request.document, request.markdown);
  });

  router.post('/api/assets', async ({ body }): Promise<AssetUploadResponse> => {
    const request = await body(AssetUploadRequestSchema);
    const id = await saveAsset(paths, {
      name: request.name,
      type: request.type,
      data: Buffer.from(request.dataBase64, 'base64'),
    });
    return { id };
  });

  router.get('/api/assets/:id', async ({ params }) => {
    const asset = await readAsset(paths, params.id ?? '');
    return raw(
      200,
      {
        'content-type': asset.type,
        // Content-addressed: the id changes whenever the bytes do, so it can be cached forever.
        'cache-control': 'private, max-age=31536000, immutable',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'",
      },
      asset.data,
    );
  });
}

async function exportMarkdown(
  paths: Paths,
  repoRoot: string,
  diffTarget: DiffTarget,
  document: ReviewDocument,
): Promise<string> {
  // Only a real root (a known parent) gets quoted code; an orphan is written as a root and keeps it.
  const known = new Set(document.comments.map((comment) => comment.id));
  const comments = await Promise.all(
    document.comments.map(async (comment): Promise<ReviewComment> => {
      const reply = comment.parentId !== null && known.has(comment.parentId);
      return {
        ...comment,
        codeContext: reply ? null : await codeContextFor(repoRoot, diffTarget, comment),
        body: replaceAssetLinks(comment.body, paths),
      };
    }),
  );
  return toMarkdown({ ...document, comments });
}

/**
 * The quoted lines `startLine..line`, capped to the last 20. A missing file or a line beyond its
 * end leaves the context null; the comment itself is still exported.
 */
async function codeContextFor(repoRoot: string, diffTarget: DiffTarget, comment: ReviewComment): Promise<string | null> {
  if (comment.path === null || comment.line === null) {
    return null;
  }
  let lines: string[];
  try {
    lines = await readBlobLines(repoRoot, diffTarget, comment.side, comment.path);
  } catch {
    return null;
  }
  const end = comment.line;
  if (end > lines.length) {
    return null;
  }
  const start = Math.max(1, Math.min(comment.startLine ?? end, end), end - (MAX_CONTEXT_LINES - 1));
  return lines.slice(start - 1, end).join('\n');
}

/**
 * `asset:<id>` becomes the absolute file path a human or an AI can open directly.
 * Fenced and inline code are skipped: they quote text (often the very Markdown being discussed),
 * and rewriting inside them would corrupt the example the author wanted to show.
 */
function replaceAssetLinks(body: string, paths: Paths): string {
  const output: string[] = [];
  let fence: { char: string; length: number } | null = null;
  for (const line of body.split('\n')) {
    if (fence === null) {
      const opened = fenceMarker(line);
      if (opened !== null) {
        fence = opened;
      } else {
        output.push(replaceOutsideCodeSpans(line, paths));
      }
      continue;
    }
    output.push(line);
    if (isFenceClose(line, fence)) {
      fence = null;
    }
  }
  return output.join('\n');
}

function replaceOutsideCodeSpans(line: string, paths: Paths): string {
  let result = '';
  let index = 0;
  while (index < line.length) {
    const open = line.indexOf('`', index);
    if (open < 0) {
      result += replaceAssets(line.slice(index), paths);
      break;
    }
    let run = 0;
    while (line[open + run] === '`') {
      run += 1;
    }
    const close = closingBackticks(line, open + run, run);
    if (close < 0) {
      result += replaceAssets(line.slice(index), paths);
      break;
    }
    result += replaceAssets(line.slice(index, open), paths) + line.slice(open, close + run);
    index = close + run;
  }
  return result;
}

function closingBackticks(line: string, from: number, length: number): number {
  let index = from;
  while (index < line.length) {
    const found = line.indexOf('`', index);
    if (found < 0) {
      return -1;
    }
    let run = 0;
    while (line[found + run] === '`') {
      run += 1;
    }
    if (run === length) {
      return found;
    }
    index = found + run;
  }
  return -1;
}

function replaceAssets(text: string, paths: Paths): string {
  return text.replace(ASSET_LINK, (_match, id: string) => join(paths.assets, id));
}

function fenceMarker(line: string): { char: string; length: number } | null {
  const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
  const char = marker?.[0];
  return marker === undefined || char === undefined ? null : { char, length: marker.length };
}

function isFenceClose(line: string, fence: { char: string; length: number }): boolean {
  const marker = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line)?.[1];
  return marker !== undefined && marker[0] === fence.char && marker.length >= fence.length;
}

async function importMarkdown(
  paths: Paths,
  repoRoot: string,
  diffTarget: DiffTarget,
  document: ReviewDocument,
  markdown: string,
) {
  const imported = fromMarkdown(markdown);
  const positions = commentPositions(markdown, imported);
  const errors: ImportError[] = [];
  const comments = await rewriteImages(paths, repoRoot, imported.comments, positions, errors);

  const summary = await diffSummary(repoRoot, { target: diffTarget, ignoreWhitespace: false, includeUntracked: true });
  const lengths = await loadLengths(repoRoot, diffTarget, comments, summary.files);

  return mergeImported({
    document,
    markdown,
    imported: { ...imported, comments },
    errors,
    files: summary.files,
    lineCount: (path, side) => lengths.get(lengthKey(path, side)) ?? null,
    now: new Date().toISOString(),
    createId: newCommentId,
  });
}

/**
 * Every absolute image path in an imported body is copied into the assets folder and rewritten to
 * `asset:<id>`. A path outside the repo/assets (or not a real image) is removed from the body and
 * reported, so the merged review never references an arbitrary local file.
 */
async function rewriteImages(
  paths: Paths,
  repoRoot: string,
  comments: ImportedComment[],
  positions: CommentPosition[],
  errors: ImportError[],
): Promise<ImportedComment[]> {
  const rewritten: ImportedComment[] = [];
  for (const [index, comment] of comments.entries()) {
    const line = positions[index]?.line ?? 1;
    const body = await replaceImages(comment.body, async (target) => {
      try {
        return `asset:${await importLocalImage(paths, repoRoot, target)}`;
      } catch (error) {
        errors.push({ line, message: `Image ${target}: ${error instanceof Error ? error.message : 'cannot be imported'}` });
        return '';
      }
    });
    rewritten.push(body === comment.body ? comment : { ...comment, body });
  }
  return rewritten;
}

async function replaceImages(body: string, resolveImage: (path: string) => Promise<string>): Promise<string> {
  const matches = [...body.matchAll(IMAGE_LINK)];
  if (matches.length === 0) {
    return body;
  }
  const parts: string[] = [];
  let cursor = 0;
  for (const match of matches) {
    const target = match[2];
    // Relative links and remote URLs are harmless Markdown; only a local absolute file is opened.
    if (target === undefined || !isAbsolute(target)) {
      continue;
    }
    const index = match.index ?? cursor;
    parts.push(body.slice(cursor, index), await resolveImage(target));
    cursor = index + (match[0] ?? '').length;
  }
  parts.push(body.slice(cursor));
  return parts.join('');
}

/** Prefetches the line counts the merge needs, one read per path and side. */
async function loadLengths(
  repoRoot: string,
  diffTarget: DiffTarget,
  comments: ImportedComment[],
  files: DiffFile[],
): Promise<Map<string, number | null>> {
  const knownPaths = new Set<string>();
  for (const file of files) {
    knownPaths.add(file.path);
    if (file.oldPath !== null) {
      knownPaths.add(file.oldPath);
    }
  }
  const wanted = new Map<string, { path: string; side: CommentSide }>();
  for (const comment of comments) {
    if (comment.path === null || comment.line === null || !knownPaths.has(comment.path)) {
      continue;
    }
    wanted.set(lengthKey(comment.path, comment.side), { path: comment.path, side: comment.side });
  }

  const entries = await Promise.all(
    [...wanted].map(async ([key, ref]): Promise<readonly [string, number | null]> => {
      try {
        return [key, (await readBlobLines(repoRoot, diffTarget, ref.side, ref.path)).length] as const;
      } catch {
        return [key, null] as const;
      }
    }),
  );
  return new Map(entries);
}

function lengthKey(path: string, side: CommentSide): string {
  return `${side}\0${path}`;
}

/** `l-` marks a local draft; the forge assigns its own ids once a comment is sent. */
function newCommentId(): string {
  return `l-${randomBytes(6).toString('hex')}`;
}

function assertTargetBelongsToRepo(target: ReviewTarget, repoRoot: string): void {
  if (target.kind !== 'local') {
    return;
  }
  if (!samePath(target.repoPath, repoRoot)) {
    throw new HttpError(400, 'Review target does not belong to this repository');
  }
}

/** Windows paths differ only in case and separators; compare them the way the OS does. */
function samePath(left: string, right: string): boolean {
  const normalize = (value: string): string => resolve(value).replaceAll('\\', '/').replace(/\/+$/, '');
  const a = normalize(left);
  const b = normalize(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}
