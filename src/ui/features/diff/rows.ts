/**
 * Turns one file of a diff into the flat list of rows the virtualized scroller renders.
 *
 * Everything on screen is a row with a known height: the file header, hunk separators ("gaps")
 * that can reveal hidden context, code lines, comment threads and notices. Code rows keep a fixed
 * height so the virtualizer can estimate them; thread and composer rows are measured after mount.
 */
import type { DiffFile } from '../../../shared/api.ts';
import type { CommentSide } from '../../../shared/review.ts';
import type { CommentThread } from '../comments/threads.ts';
import { outsideThreadKey, partitionThreads, threadKey } from '../comments/threads.ts';
import type { DiffLine, Hunk, ParsedPatch } from './patch.ts';

export const ROW_HEIGHT = { file: 41, line: 20, gap: 28, notice: 56, thread: 120, composer: 190 } as const;

/** Files with more changed lines than this are not rendered until the user asks. */
export const LARGE_FILE_CHANGES = 1500;

export type ViewMode = 'split' | 'unified';

/** How many hidden lines of a gap are revealed, counted from its top and from its bottom. */
export type GapExpansion = { top: number; bottom: number };

/** Where the inline composer sits; `line` is the last line of a range. */
export type ComposerTarget = { side: CommentSide; line: number; startLine: number | null };

export type Row =
  | { kind: 'file' }
  | { kind: 'line'; line: DiffLine }
  | { kind: 'split'; left: DiffLine | null; right: DiffLine | null }
  | {
      kind: 'gap';
      /** Index of the hunk that follows the gap; equal to the hunk count for the gap after the last hunk. */
      gapIndex: number;
      /** Hidden lines still collapsed; `null` when unknown (end of file before its content was loaded). */
      hidden: number | null;
      section: string;
      canExpandUp: boolean;
      canExpandDown: boolean;
    }
  | { kind: 'notice'; notice: 'loading' | 'error' | 'binary' | 'large' | 'empty'; height: number }
  | { kind: 'thread'; threadKey: string }
  | { kind: 'composer'; side: CommentSide; line: number; startLine: number | null };

export type FileView = {
  file: DiffFile;
  collapsed: boolean;
  load: { status: 'idle' | 'loading' } | { status: 'error'; message: string } | { status: 'loaded'; patch: ParsedPatch };
  /** The user asked to render a file that is skipped by default because of its size. */
  forceLarge: boolean;
  expansions: ReadonlyMap<number, GapExpansion>;
  /** New-side content of the file, once fetched for expanding context. */
  blob: readonly string[] | null;
};

export function rowHeight(row: Row): number {
  switch (row.kind) {
    case 'file':
      return ROW_HEIGHT.file;
    case 'line':
    case 'split':
      return ROW_HEIGHT.line;
    case 'gap':
      return ROW_HEIGHT.gap;
    case 'notice':
      return row.height;
    case 'thread':
      return ROW_HEIGHT.thread;
    case 'composer':
      return ROW_HEIGHT.composer;
  }
}

/** Thread and composer rows size themselves; the virtualizer measures them after they render. */
export function isMeasuredRow(row: Row): boolean {
  return row.kind === 'thread' || row.kind === 'composer';
}

export function isLargeFile(file: DiffFile): boolean {
  return file.additions + file.deletions > LARGE_FILE_CHANGES;
}

export function buildFileRows(
  view: FileView,
  mode: ViewMode,
  threads: readonly CommentThread[] = [],
  composer: ComposerTarget | null = null,
): Row[] {
  const rows: Row[] = [{ kind: 'file' }];
  if (view.collapsed) {
    return rows;
  }
  const { file, load } = view;
  if (file.binary) {
    rows.push(notice('binary'));
  } else if (isLargeFile(file) && !view.forceLarge) {
    rows.push(notice('large'));
  } else if (load.status === 'error') {
    rows.push(notice('error'));
  } else if (load.status !== 'loaded') {
    // Sized roughly like the real content so the scrollbar is believable before the patch arrives.
    const estimate = Math.min(Math.max((file.additions + file.deletions) * ROW_HEIGHT.line, ROW_HEIGHT.notice), 400);
    rows.push({ kind: 'notice', notice: 'loading', height: estimate });
  } else if (load.patch.binary) {
    rows.push(notice('binary'));
  } else if (load.patch.hunks.length === 0) {
    rows.push(notice('empty'));
  } else {
    pushHunkRows(rows, view, load.patch.hunks, mode);
  }
  insertCommentRows(rows, file.path, threads, composer);
  return rows;
}

function notice(kind: 'error' | 'binary' | 'large' | 'empty'): Row {
  return { kind: 'notice', notice: kind, height: ROW_HEIGHT.notice };
}

/**
 * Inserts thread rows after the line they belong to. A comment whose line is not in the current
 * hunks/expansions would otherwise vanish; it is collected in one row under the file header.
 */
function insertCommentRows(
  rows: Row[],
  path: string,
  threads: readonly CommentThread[],
  composer: ComposerTarget | null,
): void {
  if (threads.length === 0 && composer === null) {
    return;
  }
  const anchors = anchorIndexes(rows, path);
  const visible = new Set(anchors.keys());
  const { inline, outside } = partitionThreads(threads, visible);
  const after = new Map<number, Row[]>();
  const pushAfter = (index: number, row: Row) => {
    const list = after.get(index) ?? [];
    list.push(row);
    after.set(index, list);
  };

  if (outside.length > 0) {
    pushAfter(0, { kind: 'thread', threadKey: outsideThreadKey(path) });
  }
  for (const thread of inline) {
    const index = anchors.get(thread.key);
    if (index !== undefined) {
      pushAfter(index, { kind: 'thread', threadKey: thread.key });
    }
  }
  if (composer !== null) {
    const index = anchors.get(threadKey(path, composer.side, composer.line)) ?? 0;
    pushAfter(index, { kind: 'composer', side: composer.side, line: composer.line, startLine: composer.startLine });
  }

  // Rebuild once: changing `rows` while walking it would move the anchors still to be visited.
  const result: Row[] = [];
  for (const [index, row] of rows.entries()) {
    result.push(row);
    const extras = after.get(index);
    if (extras !== undefined) {
      result.push(...extras);
    }
  }
  rows.splice(0, rows.length, ...result);
}

/** Row index of every line that can carry a comment, keyed like a thread. */
function anchorIndexes(rows: readonly Row[], path: string): Map<string, number> {
  const indexes = new Map<string, number>();
  for (const [index, row] of rows.entries()) {
    if (row.kind === 'line') {
      addLineAnchor(indexes, path, index, row.line);
    } else if (row.kind === 'split') {
      if (row.left) {
        addAnchor(indexes, path, 'old', index, row.left.oldNo);
      }
      if (row.right) {
        addAnchor(indexes, path, 'new', index, row.right.newNo);
      }
    }
  }
  return indexes;
}

/** Keys of the comment anchors currently visible in a file; used to collect all invisible threads. */
export function visibleThreadKeys(rows: readonly Row[], path: string): Set<string> {
  return new Set(anchorIndexes(rows, path).keys());
}

function addLineAnchor(indexes: Map<string, number>, path: string, index: number, line: DiffLine): void {
  // A context line exists on both sides; a comment on either side belongs after this row.
  if (line.oldNo !== null) {
    addAnchor(indexes, path, 'old', index, line.oldNo);
  }
  if (line.newNo !== null) {
    addAnchor(indexes, path, 'new', index, line.newNo);
  }
}

function addAnchor(
  indexes: Map<string, number>,
  path: string,
  side: CommentSide,
  index: number,
  line: number | null,
): void {
  if (line !== null) {
    indexes.set(threadKey(path, side, line), index);
  }
}

function pushHunkRows(rows: Row[], view: FileView, hunks: Hunk[], mode: ViewMode): void {
  // Only a modified file has unchanged lines outside its hunks.
  const hasContext = view.file.status === 'modified' || view.file.status === 'renamed' || view.file.status === 'copied';
  for (const [index, hunk] of hunks.entries()) {
    if (hasContext) {
      pushGapRows(rows, view, hunks, index, mode);
    }
    pushLineRows(rows, hunk.lines, mode);
  }
  if (hasContext) {
    pushGapRows(rows, view, hunks, hunks.length, mode);
  }
}

/** First line (new side) after a hunk, and the first line a hunk covers. */
const newEnd = (hunk: Hunk) => (hunk.newLines === 0 ? hunk.newStart : hunk.newStart + hunk.newLines - 1);
const newFirst = (hunk: Hunk) => (hunk.newLines === 0 ? hunk.newStart + 1 : hunk.newStart);
const oldEnd = (hunk: Hunk) => (hunk.oldLines === 0 ? hunk.oldStart : hunk.oldStart + hunk.oldLines - 1);
const oldFirst = (hunk: Hunk) => (hunk.oldLines === 0 ? hunk.oldStart + 1 : hunk.oldStart);

/** The hidden new-side line range of a gap and the offset that maps its new line numbers to old ones. */
export function gapRange(hunks: Hunk[], gapIndex: number, blobLength: number | null): { start: number; end: number | null; oldOffset: number } {
  const before = hunks[gapIndex - 1];
  const after = hunks[gapIndex];
  const start = before ? newEnd(before) + 1 : 1;
  if (after) {
    return { start, end: newFirst(after) - 1, oldOffset: oldFirst(after) - newFirst(after) };
  }
  return { start, end: blobLength, oldOffset: before ? oldEnd(before) - newEnd(before) : 0 };
}

function pushGapRows(rows: Row[], view: FileView, hunks: Hunk[], gapIndex: number, mode: ViewMode): void {
  const { start, end, oldOffset } = gapRange(hunks, gapIndex, view.blob?.length ?? null);
  const isFirst = gapIndex === 0;
  const isLast = gapIndex === hunks.length;
  const section = hunks[gapIndex]?.section ?? '';
  const gapRow = (hidden: number | null): Row => ({
    kind: 'gap',
    gapIndex,
    hidden,
    section,
    // Lines appear next to the hunk they extend: below the previous hunk, above the next one.
    canExpandDown: !isFirst,
    canExpandUp: !isLast,
  });

  if (end === null) {
    // End of file is unknown until the content is fetched; offer the expander and find out then.
    rows.push(gapRow(null));
    return;
  }
  const total = end - start + 1;
  if (total <= 0) {
    return;
  }
  const expansion = view.expansions.get(gapIndex) ?? { top: 0, bottom: 0 };
  const top = Math.min(expansion.top, total);
  const bottom = Math.min(expansion.bottom, total - top);
  const contextLine = (newNo: number): DiffLine => ({ type: 'context', oldNo: newNo + oldOffset, newNo, text: view.blob?.[newNo - 1] ?? '' });
  const range = (from: number, count: number) => Array.from({ length: count }, (_, offset) => contextLine(from + offset));

  pushLineRows(rows, range(start, top), mode);
  if (total - top - bottom > 0) {
    rows.push(gapRow(total - top - bottom));
  }
  pushLineRows(rows, range(end - bottom + 1, bottom), mode);
}

function pushLineRows(rows: Row[], lines: DiffLine[], mode: ViewMode): void {
  if (mode === 'unified') {
    for (const line of lines) {
      rows.push({ kind: 'line', line });
    }
    return;
  }
  // Split view: a run of deletions followed by additions is shown side by side, pairwise.
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (line === undefined) {
      break;
    }
    if (line.type === 'context') {
      rows.push({ kind: 'split', left: line, right: line });
      index += 1;
      continue;
    }
    const deleted: DiffLine[] = [];
    const added: DiffLine[] = [];
    while (lines[index]?.type === 'del') {
      deleted.push(lines[index++] as DiffLine);
    }
    while (lines[index]?.type === 'add') {
      added.push(lines[index++] as DiffLine);
    }
    for (let pair = 0; pair < Math.max(deleted.length, added.length); pair++) {
      rows.push({ kind: 'split', left: deleted[pair] ?? null, right: added[pair] ?? null });
    }
  }
}
