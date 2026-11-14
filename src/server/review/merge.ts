/**
 * Merging an imported Markdown review into the open document.
 *
 * Kept pure: the caller supplies the clock, the id generator, the current diff file list and a way
 * to read file lengths, so the rules (id preservation, reply mapping, path/line validation) are
 * testable without git or a clock. `commentPositions` recovers the Markdown line of every imported
 * comment, because the codec deliberately drops that layout detail from the model.
 */
import type {
  CommentSide,
  ImportedComment,
  ImportError,
  ImportResult,
  ReviewComment,
  ReviewDocument,
} from '../../shared/review.ts';
import { fromMarkdown } from './markdown.ts';

export type MergeReport = {
  added: number;
  edited: number;
  skipped: number;
  errors: ImportError[];
};

export type MergeFile = { path: string; oldPath: string | null };

export type MergeInput = {
  document: ReviewDocument;
  markdown: string;
  /** The codec result; the caller may already have rewritten comment bodies. */
  imported: ImportResult;
  /** Errors found before merging (for example an image that could not be imported). */
  errors?: ImportError[];
  files: MergeFile[];
  /** Number of lines at one side of a file, or `null` when it cannot be read. */
  lineCount: (path: string, side: CommentSide) => number | null;
  now: string;
  createId: () => string;
};

export type MergeResult = { document: ReviewDocument; report: MergeReport };

/** Position of an imported comment in the source text. */
export type CommentPosition = { line: number; reply: boolean };

/** Parse and merge in one call; the route uses `mergeImported` after rewriting images. */
export function mergeMarkdown(markdown: string, options: Omit<MergeInput, 'markdown' | 'imported'>): MergeResult {
  return mergeImported({ ...options, markdown, imported: fromMarkdown(markdown) });
}

export function mergeImported(input: MergeInput): MergeResult {
  const { document, imported, files, lineCount, now, createId } = input;
  const positions = commentPositions(input.markdown, imported);
  const errors: ImportError[] = [...(input.errors ?? []), ...imported.errors];
  const report: MergeReport = { added: 0, edited: 0, skipped: 0, errors };

  const knownPaths = new Set<string>();
  for (const file of files) {
    knownPaths.add(file.path);
    if (file.oldPath !== null) {
      knownPaths.add(file.oldPath);
    }
  }

  const comments = [...document.comments];
  const indexById = new Map<string, number>();
  comments.forEach((comment, index) => indexById.set(comment.id, index));
  /** Imported id → local id, for a new comment whose section carried an unknown id. */
  const remapped = new Map<string, string>();

  const validate = (comment: ImportedComment): string | null => {
    if (comment.path === null) {
      return null;
    }
    if (!knownPaths.has(comment.path)) {
      return `${comment.path} is not part of the current diff`;
    }
    if (comment.line === null) {
      return null;
    }
    const length = lineCount(comment.path, comment.side);
    if (length === null) {
      return `Cannot read ${comment.path} (${comment.side})`;
    }
    if (comment.line > length) {
      return `Line ${comment.line} is beyond the end of ${comment.path} (${length} lines)`;
    }
    return null;
  };

  const upsert = (comment: ImportedComment, parentId: string | null): ReviewComment => {
    const existingIndex = comment.id === null ? undefined : indexById.get(comment.id);
    if (existingIndex !== undefined) {
      const existing = comments[existingIndex];
      if (existing !== undefined) {
        if (existing.body === comment.body) {
          report.skipped += 1;
          return existing;
        }
        const updated: ReviewComment = { ...existing, body: comment.body, updatedAt: now };
        comments[existingIndex] = updated;
        report.edited += 1;
        return updated;
      }
    }

    const id = createId();
    const created: ReviewComment = {
      id,
      parentId,
      path: comment.path,
      side: comment.side,
      line: comment.line,
      startLine: comment.startLine,
      body: comment.body,
      author: null,
      state: 'draft',
      createdAt: now,
      updatedAt: now,
      codeContext: null,
      outdated: false,
    };
    comments.push(created);
    indexById.set(id, comments.length - 1);
    report.added += 1;
    if (comment.id !== null) {
      remapped.set(comment.id, id);
    }
    return created;
  };

  let lastRootId: string | null = null;
  for (const [index, importedComment] of imported.comments.entries()) {
    const position = positions[index] ?? { line: 1, reply: false };
    const problem = validate(importedComment);
    if (problem !== null) {
      errors.push({ line: position.line, message: problem });
      // A skipped root invalidates the replies that pointed at it.
      if (!position.reply) {
        lastRootId = null;
      }
      continue;
    }

    let parentId: string | null = null;
    if (position.reply) {
      parentId = importedComment.parentId === null ? lastRootId : (remapped.get(importedComment.parentId) ?? importedComment.parentId);
      if (parentId !== null && !indexById.has(parentId)) {
        parentId = lastRootId;
      }
      if (parentId === null) {
        errors.push({ line: position.line, message: 'Reply has no comment above it' });
        continue;
      }
    }

    const merged = upsert(importedComment, parentId);
    if (!position.reply) {
      lastRootId = merged.id;
    }
  }

  return {
    document: {
      ...document,
      summary: imported.document.summary ?? document.summary,
      action: imported.document.action ?? document.action,
      comments,
    },
    report,
  };
}

/**
 * Markdown line of each imported comment's heading, in comment order.
 *
 * The codec reports the lines it could not read, so the remaining headings minus `Summary` are
 * exactly the sections that became comments; slicing to the comment count covers the section cap.
 */
export function commentPositions(markdown: string, imported: ImportResult): CommentPosition[] {
  const failed = new Set(imported.errors.map((error) => error.line));
  const lines = markdown.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n');
  const positions: CommentPosition[] = [];
  let fence = 0;
  let inSection = false;

  for (const [index, raw] of lines.entries()) {
    const line = raw.trimEnd();
    if (fence > 0) {
      if (isFenceClose(line, fence)) {
        fence = 0;
      }
      continue;
    }
    const ticks = fenceTicks(line);
    if (inSection && ticks >= 3) {
      fence = ticks;
      continue;
    }

    const start = line.trimStart();
    let reply: boolean;
    let heading: string;
    if (start.startsWith('### ')) {
      reply = true;
      heading = start.slice(4);
    } else if (start.startsWith('## ')) {
      reply = false;
      heading = start.slice(3);
    } else {
      continue;
    }
    inSection = true;
    const lineNumber = index + 1;
    if (!reply && heading === 'Summary') {
      continue;
    }
    if (failed.has(lineNumber)) {
      continue;
    }
    positions.push({ line: lineNumber, reply });
  }
  return positions.slice(0, imported.comments.length);
}

function fenceTicks(line: string): number {
  let count = 0;
  while (line[count] === '`') {
    count += 1;
  }
  return count;
}

function isFenceClose(line: string, open: number): boolean {
  const trimmed = line.trim();
  return trimmed.length >= open && /^`+$/.test(trimmed);
}
