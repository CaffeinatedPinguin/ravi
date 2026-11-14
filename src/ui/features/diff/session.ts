/**
 * State of one open diff, kept outside React.
 *
 * A diff can hold thousands of files, so React must not own this state: a change to one file
 * would re-render everything. Instead the session keeps per-file state, rebuilds rows only for
 * files that changed, and exposes a version number through `useSyncExternalStore`. Components
 * read exactly the rows they show.
 */
import { BlobSchema, PatchesSchema } from '../../../shared/api.ts';
import type { DiffFile, DiffOptions, DiffSummary } from '../../../shared/api.ts';
import type { ReviewComment } from '../../../shared/review.ts';
import { apiSend } from '../../app/api.ts';
import type { CommentThread } from '../comments/threads.ts';
import { groupThreads, isOutsideThreadKey, pathFromOutsideThreadKey } from '../comments/threads.ts';
import { highlightLines, languageForPath } from './highlight.ts';
import type { LineTokens } from './highlight.ts';
import { parsePatch } from './patch.ts';
import type { DiffLine, Hunk } from './patch.ts';
import { buildFileRows, gapRange, isLargeFile, visibleThreadKeys } from './rows.ts';
import type { ComposerTarget, FileView, GapExpansion, Row, ViewMode } from './rows.ts';

/** Files requested in one patches call; bounded because paths travel as git arguments. */
const BATCH_SIZE = 40;
/** Files with more lines than this are shown without syntax colours to keep the worker responsive. */
const MAX_HIGHLIGHT_LINES = 20_000;

export type RowRef = { fileIndex: number; localIndex: number; row: Row };
export type FileTokens = { old: ReadonlyMap<number, LineTokens>; new: ReadonlyMap<number, LineTokens> };
export type ExpandDirection = 'up' | 'down' | 'all';

let nextSessionId = 0;

export class DiffSession {
  /** Distinguishes sessions, so the view can start fresh (scroll position included) for a new diff. */
  readonly id = nextSessionId++;
  readonly files: readonly DiffFile[];
  private readonly repoId: string;
  private readonly options: DiffOptions;
  private mode: ViewMode;
  private readonly views: FileView[];
  private readonly rowCache: Array<Row[] | null>;
  private readonly tokens = new Map<number, FileTokens>();
  private readonly highlightRequested = new Set<number>();
  /** Diff files by path; comments come with a path, not a file index. */
  private readonly fileIndexesByPath = new Map<string, number[]>();
  private commentsByPath = new Map<string, readonly ReviewComment[]>();
  private threadsByPath = new Map<string, CommentThread[]>();
  private threadsByKey = new Map<string, CommentThread[]>();
  private commentCounts = new Map<string, number>();
  private readonly composers = new Map<number, ComposerTarget>();
  /** Row index at which each file starts; rebuilt lazily after any change. */
  private starts: number[] | null = null;
  private totalRows = 0;
  private version = 0;
  private readonly listeners = new Set<() => void>();
  private readonly queue = new Set<number>();
  private flushScheduled = false;
  private longestLine = 0;

  constructor(repoId: string, options: DiffOptions, summary: DiffSummary, mode: ViewMode) {
    this.repoId = repoId;
    this.options = options;
    this.mode = mode;
    this.files = summary.files;
    this.views = summary.files.map((file) => ({
      file,
      collapsed: false,
      load: { status: 'idle' },
      forceLarge: false,
      expansions: new Map(),
      blob: null,
    }));
    this.rowCache = summary.files.map(() => null);
    for (const [index, file] of summary.files.entries()) {
      const indexes = this.fileIndexesByPath.get(file.path) ?? [];
      indexes.push(index);
      this.fileIndexesByPath.set(file.path, indexes);
    }
  }

  // ── Subscription (useSyncExternalStore) ──────────────────────────────────

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = (): number => this.version;

  // ── Reading rows ─────────────────────────────────────────────────────────

  get rowCount(): number {
    this.ensureLayout();
    return this.totalRows;
  }

  /** Length in characters of the longest loaded line; sizes the horizontal scroll area. */
  get longestLineLength(): number {
    return this.longestLine;
  }

  rowAt(index: number): RowRef | null {
    const fileIndex = this.fileIndexAtRow(index);
    const start = this.fileStartRow(fileIndex);
    const row = this.rowsOf(fileIndex)[index - start];
    return row ? { fileIndex, localIndex: index - start, row } : null;
  }

  fileStartRow(fileIndex: number): number {
    return this.ensureLayout()[fileIndex] ?? 0;
  }

  fileIndexAtRow(index: number): number {
    return lastIndexAtOrBelow(this.ensureLayout(), index);
  }

  view(fileIndex: number): FileView | undefined {
    return this.views[fileIndex];
  }

  tokensOf(fileIndex: number): FileTokens | undefined {
    return this.tokens.get(fileIndex);
  }

  /** Number of comments (replies included) anchored in a file; shown in its header and in the tree. */
  commentCount(path: string): number {
    return this.commentCounts.get(path) ?? 0;
  }

  /** Threads behind a row key; an outside key collects every thread the visible hunks cannot show. */
  threadsOf(key: string): readonly CommentThread[] {
    if (!isOutsideThreadKey(key)) {
      return this.threadsByKey.get(key) ?? [];
    }
    const path = pathFromOutsideThreadKey(key);
    const visible = new Set<string>();
    for (const index of this.fileIndexesByPath.get(path) ?? []) {
      for (const rowKey of visibleThreadKeys(this.rowsOf(index), path)) {
        visible.add(rowKey);
      }
    }
    return (this.threadsByPath.get(path) ?? []).filter((thread) => !visible.has(thread.key));
  }

  composerFor(fileIndex: number): ComposerTarget | null {
    return this.composers.get(fileIndex) ?? null;
  }

  /** Opens the inline composer; shift-click on another line of the same side extends the range. */
  openComposer(fileIndex: number, side: ComposerTarget['side'], line: number, extend = false): void {
    const current = this.composers.get(fileIndex);
    const target: ComposerTarget =
      extend && current !== undefined && current.side === side
        ? {
            side,
            startLine: Math.min(current.startLine ?? current.line, line),
            line: Math.max(current.startLine ?? current.line, line),
          }
        : { side, line, startLine: null };
    this.composers.set(fileIndex, target);
    this.invalidate([fileIndex]);
  }

  closeComposer(fileIndex: number): void {
    if (this.composers.delete(fileIndex)) {
      this.invalidate([fileIndex]);
    }
  }

  // ── Commands ─────────────────────────────────────────────────────────────

  setMode(mode: ViewMode): void {
    if (mode !== this.mode) {
      this.mode = mode;
      this.rowCache.fill(null);
      this.changed();
    }
  }

  /**
   * Replaces the review comments and invalidates only the files whose comments changed.
   * The store creates new objects for edits and keeps the rest by reference, so a cheap identity
   * comparison is enough; work stays proportional to the comments, not to the file count.
   */
  setComments(comments: readonly ReviewComment[]): void {
    const byPath = new Map<string, ReviewComment[]>();
    const counts = new Map<string, number>();
    for (const comment of comments) {
      if (comment.path === null) {
        continue;
      }
      const list = byPath.get(comment.path) ?? [];
      list.push(comment);
      byPath.set(comment.path, list);
      counts.set(comment.path, (counts.get(comment.path) ?? 0) + 1);
    }
    const changed: string[] = [];
    for (const [path, list] of byPath) {
      if (!sameComments(this.commentsByPath.get(path), list)) {
        changed.push(path);
      }
    }
    for (const path of this.commentsByPath.keys()) {
      if (!byPath.has(path)) {
        changed.push(path);
      }
    }
    if (changed.length === 0) {
      return;
    }
    this.commentsByPath = byPath;
    this.commentCounts = counts;
    this.threadsByPath = new Map();
    this.threadsByKey = new Map();
    for (const thread of groupThreads(comments)) {
      const forPath = this.threadsByPath.get(thread.path) ?? [];
      forPath.push(thread);
      this.threadsByPath.set(thread.path, forPath);
      const forKey = this.threadsByKey.get(thread.key) ?? [];
      forKey.push(thread);
      this.threadsByKey.set(thread.key, forKey);
    }
    for (const path of changed) {
      for (const index of this.fileIndexesByPath.get(path) ?? []) {
        this.rowCache[index] = null;
      }
    }
    this.changed();
  }

  /** Asks for the patches of files that are about to be visible; requests are batched. */
  requestFiles(fileIndexes: Iterable<number>): void {
    for (const index of fileIndexes) {
      const view = this.views[index];
      if (view && this.needsPatch(view)) {
        view.load = { status: 'loading' };
        this.queue.add(index);
      }
      this.requestHighlight(index);
    }
    if (this.queue.size > 0 && !this.flushScheduled) {
      this.flushScheduled = true;
      queueMicrotask(() => this.flush());
    }
  }

  toggleCollapsed(fileIndex: number): void {
    this.update(fileIndex, (view) => ({ ...view, collapsed: !view.collapsed }));
  }

  setAllCollapsed(collapsed: boolean): void {
    for (const [index, view] of this.views.entries()) {
      this.views[index] = { ...view, collapsed };
    }
    this.rowCache.fill(null);
    this.changed();
  }

  loadLargeFile(fileIndex: number): void {
    this.update(fileIndex, (view) => ({ ...view, forceLarge: true }));
    this.requestFiles([fileIndex]);
  }

  retry(fileIndex: number): void {
    this.update(fileIndex, (view) => ({ ...view, load: { status: 'idle' } }));
    this.requestFiles([fileIndex]);
  }

  /** Reveals hidden lines of a gap; the file content is fetched on first use. */
  async expandGap(fileIndex: number, gapIndex: number, direction: ExpandDirection, step: number): Promise<void> {
    const blob = await this.ensureBlob(fileIndex);
    const view = this.views[fileIndex];
    if (!view || view.load.status !== 'loaded') {
      return;
    }
    const range = gapRange(view.load.patch.hunks, gapIndex, blob.length);
    const total = (range.end ?? blob.length) - range.start + 1;
    const current = view.expansions.get(gapIndex) ?? { top: 0, bottom: 0 };
    const next: GapExpansion =
      direction === 'all'
        ? { top: total, bottom: 0 }
        : direction === 'down'
          ? { ...current, top: current.top + step }
          : { ...current, bottom: current.bottom + step };
    this.update(fileIndex, (latest) => ({ ...latest, expansions: new Map(latest.expansions).set(gapIndex, next) }));
  }

  async expandWholeFile(fileIndex: number): Promise<void> {
    const blob = await this.ensureBlob(fileIndex);
    this.update(fileIndex, (view) => {
      if (view.load.status !== 'loaded') {
        return view;
      }
      const expansions = new Map<number, GapExpansion>();
      for (let gap = 0; gap <= view.load.patch.hunks.length; gap++) {
        expansions.set(gap, { top: blob.length, bottom: 0 });
      }
      return { ...view, expansions };
    });
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private needsPatch(view: FileView): boolean {
    return view.load.status === 'idle' && !view.collapsed && !view.file.binary && (!isLargeFile(view.file) || view.forceLarge);
  }

  private flush(): void {
    this.flushScheduled = false;
    const indexes = [...this.queue];
    this.queue.clear();
    for (let offset = 0; offset < indexes.length; offset += BATCH_SIZE) {
      void this.loadBatch(indexes.slice(offset, offset + BATCH_SIZE));
    }
    this.invalidate(indexes);
  }

  private async loadBatch(indexes: number[]): Promise<void> {
    const files = indexes.flatMap((index) => {
      const file = this.files[index];
      return file ? [{ path: file.path, oldPath: file.oldPath, status: file.status }] : [];
    });
    try {
      const patches = await apiSend('POST', `/api/repos/${this.repoId}/diff/patches`, { ...this.options, files }, PatchesSchema);
      for (const index of indexes) {
        const view = this.views[index];
        if (view) {
          const patch = parsePatch(patches[view.file.path] ?? '');
          this.views[index] = { ...view, load: { status: 'loaded', patch } };
          this.trackLongestLine(patch.hunks);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not load the diff';
      for (const index of indexes) {
        const view = this.views[index];
        if (view) {
          this.views[index] = { ...view, load: { status: 'error', message } };
        }
      }
    }
    this.invalidate(indexes);
    this.requestFilesHighlight(indexes);
  }

  private trackLongestLine(hunks: Hunk[]): void {
    for (const hunk of hunks) {
      for (const line of hunk.lines) {
        if (line.text.length > this.longestLine) {
          this.longestLine = line.text.length;
        }
      }
    }
  }

  private async ensureBlob(fileIndex: number): Promise<readonly string[]> {
    const view = this.views[fileIndex];
    if (!view) {
      return [];
    }
    if (view.blob) {
      return view.blob;
    }
    const request = { target: this.options.target, side: 'new', path: view.file.path };
    const { lines } = await apiSend('POST', `/api/repos/${this.repoId}/blob`, request, BlobSchema);
    this.update(fileIndex, (latest) => ({ ...latest, blob: lines }));
    // With the whole file available, colours can be computed from real context instead of hunk fragments.
    this.highlightRequested.delete(fileIndex);
    this.requestHighlight(fileIndex);
    return lines;
  }

  private requestFilesHighlight(indexes: number[]): void {
    for (const index of indexes) {
      this.requestHighlight(index);
    }
  }

  private requestHighlight(fileIndex: number): void {
    const view = this.views[fileIndex];
    if (!view || view.load.status !== 'loaded' || this.highlightRequested.has(fileIndex)) {
      return;
    }
    const language = languageForPath(view.file.path);
    if (language === null) {
      return;
    }
    this.highlightRequested.add(fileIndex);
    const lines = view.load.patch.hunks.flatMap((hunk) => hunk.lines);
    const oldSide = lines.filter((line) => line.oldNo !== null);
    const newSide = view.blob ? null : lines.filter((line) => line.newNo !== null);
    if (oldSide.length + (view.blob?.length ?? newSide?.length ?? 0) > MAX_HIGHLIGHT_LINES) {
      return;
    }
    const numbered = (side: DiffLine[], key: 'oldNo' | 'newNo') =>
      highlightLines(
        language,
        side.map((line) => line.text),
      ).then((result) => new Map(result.map((tokens, index) => [side[index]?.[key] ?? 0, tokens])));
    const newTokens = view.blob
      ? highlightLines(language, view.blob).then((result) => new Map(result.map((tokens, index) => [index + 1, tokens])))
      : numbered(newSide ?? [], 'newNo');

    Promise.all([numbered(oldSide, 'oldNo'), newTokens])
      .then(([oldMap, newMap]) => {
        this.tokens.set(fileIndex, { old: oldMap, new: newMap });
        this.changed();
      })
      .catch(() => {
        // Colours are an enhancement; plain text stays readable if the worker fails.
      });
  }

  private update(fileIndex: number, change: (view: FileView) => FileView): void {
    const view = this.views[fileIndex];
    if (view) {
      this.views[fileIndex] = change(view);
      this.invalidate([fileIndex]);
    }
  }

  private invalidate(indexes: number[]): void {
    for (const index of indexes) {
      this.rowCache[index] = null;
    }
    this.changed();
  }

  private changed(): void {
    this.starts = null;
    this.version += 1;
    for (const listener of this.listeners) {
      listener();
    }
  }

  private rowsOf(fileIndex: number): Row[] {
    let rows = this.rowCache[fileIndex];
    if (!rows) {
      const view = this.views[fileIndex];
      rows = view
        ? buildFileRows(view, this.mode, this.threadsByPath.get(view.file.path) ?? [], this.composerFor(fileIndex))
        : [];
      this.rowCache[fileIndex] = rows;
    }
    return rows;
  }

  private ensureLayout(): number[] {
    if (this.starts) {
      return this.starts;
    }
    const starts: number[] = [];
    let rowTotal = 0;
    for (let index = 0; index < this.views.length; index++) {
      starts.push(rowTotal);
      rowTotal += this.rowsOf(index).length;
    }
    this.starts = starts;
    this.totalRows = rowTotal;
    return starts;
  }
}

/** Objects are immutable in the store, so unchanged comments keep their identity. */
function sameComments(left: readonly ReviewComment[] | undefined, right: readonly ReviewComment[]): boolean {
  if (left === undefined) {
    return right.length === 0;
  }
  if (left.length !== right.length) {
    return false;
  }
  return left.every((comment, index) => comment === right[index]);
}

/** Index of the last element of an ascending array that is ≤ `value` (binary search). */
function lastIndexAtOrBelow(sorted: number[], value: number): number {
  let low = 0;
  let high = sorted.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if ((sorted[middle] ?? 0) <= value) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return low;
}
