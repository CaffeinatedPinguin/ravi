/**
 * The open review document, kept outside React and saved as a whole.
 *
 * A review can hold thousands of comments, so React must not own the document: mutations rebuild
 * the comment array, bump a version, and `useSyncExternalStore` lets the visible components decide
 * what to re-render. Saving is debounced, and a save that overlaps a newer edit is followed by
 * another save instead of overwriting the edit with the server copy.
 */
import { ReviewDocumentSchema } from '../../../shared/review.ts';
import type { CommentSide, ReviewComment, ReviewDocument, ReviewTarget } from '../../../shared/review.ts';
import { apiSend } from '../../app/api.ts';
import type { SaveStatus } from './types.ts';

const SAVE_DELAY = 800;

export type NewComment = {
  path: string;
  side: CommentSide;
  line: number;
  startLine?: number | null;
  body: string;
};

export class ReviewStore {
  private readonly repoId: string;
  private doc: ReviewDocument;
  private countsDocument: ReviewDocument | null = null;
  private commentCountMap: ReadonlyMap<string, number> = new Map();
  private status: SaveStatus = 'saved';
  private saveError: string | null = null;
  private version = 0;
  private readonly listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private revision = 0;
  private savedRevision = 0;
  private saving: Promise<void> | null = null;

  constructor(repoId: string, target: ReviewTarget) {
    this.repoId = repoId;
    this.doc = { version: 1, target, baseSha: null, headSha: null, action: null, summary: null, comments: [] };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getVersion = (): number => this.version;

  get document(): ReviewDocument {
    return this.doc;
  }

  get saveStatus(): SaveStatus {
    return this.status;
  }

  /** Comments per file, rebuilt only when the document (not the save status) changes. */
  commentCounts(): ReadonlyMap<string, number> {
    if (this.countsDocument !== this.doc) {
      const counts = new Map<string, number>();
      for (const comment of this.doc.comments) {
        if (comment.path !== null) {
          counts.set(comment.path, (counts.get(comment.path) ?? 0) + 1);
        }
      }
      this.countsDocument = this.doc;
      this.commentCountMap = counts;
    }
    return this.commentCountMap;
  }

  get loadError(): string | null {
    return this.saveError;
  }

  get hasUnsaved(): boolean {
    return this.revision !== this.savedRevision;
  }

  async load(): Promise<void> {
    try {
      const stored = await apiSend(
        'POST',
        '/api/reviews/load',
        { repoId: this.repoId, target: this.doc.target },
        ReviewDocumentSchema,
      );
      this.doc = stored;
      this.revision = 0;
      this.savedRevision = 0;
      this.status = 'saved';
      this.saveError = null;
    } catch (reason) {
      this.status = 'error';
      this.saveError = message(reason);
    }
    this.changed();
  }

  add(comment: NewComment): string {
    const now = new Date().toISOString();
    const id = `l-${randomId()}`;
    const created: ReviewComment = {
      id,
      parentId: null,
      path: comment.path,
      side: comment.side,
      line: comment.line,
      startLine: comment.startLine ?? null,
      body: comment.body,
      author: null,
      state: 'draft',
      createdAt: now,
      updatedAt: now,
      codeContext: null,
      outdated: false,
    };
    this.mutate({ ...this.doc, comments: [...this.doc.comments, created] });
    return id;
  }

  edit(id: string, body: string): void {
    const now = new Date().toISOString();
    this.mutate({
      ...this.doc,
      comments: this.doc.comments.map((comment) => (comment.id === id ? { ...comment, body, updatedAt: now } : comment)),
    });
  }

  /** Review-level summary; an empty textarea clears it instead of storing whitespace. */
  setSummary(summary: string | null): void {
    const value = summary !== null && summary.trim() === '' ? null : summary;
    if (value === this.doc.summary) {
      return;
    }
    this.mutate({ ...this.doc, summary: value });
  }

  /** A comment on the whole review: no file, side or line, so it only lives in the notes panel. */
  addGeneral(body: string): string {
    const now = new Date().toISOString();
    const id = `l-${randomId()}`;
    this.mutate({
      ...this.doc,
      comments: [
        ...this.doc.comments,
        {
          id,
          parentId: null,
          path: null,
          side: 'new',
          line: null,
          startLine: null,
          body,
          author: null,
          state: 'draft',
          createdAt: now,
          updatedAt: now,
          codeContext: null,
          outdated: false,
        },
      ],
    });
    return id;
  }

  /**
   * Replaces the whole document (an import) through the normal debounced save. The returned
   * function restores the previous document, so an import can be undone from the toast.
   */
  replaceDocument(document: ReviewDocument): () => void {
    const previous = this.doc;
    this.mutate(document);
    let undone = false;
    return () => {
      if (undone) {
        return;
      }
      undone = true;
      this.mutate(previous);
    };
  }

  /** Deletes a comment and its replies; the returned function puts all of them back in place. */
  remove(id: string): () => void {
    const removedIds = new Set([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const comment of this.doc.comments) {
        if (comment.parentId !== null && removedIds.has(comment.parentId) && !removedIds.has(comment.id)) {
          removedIds.add(comment.id);
          grew = true;
        }
      }
    }
    const removed = this.doc.comments
      .map((comment, index) => ({ comment, index }))
      .filter(({ comment }) => removedIds.has(comment.id));
    if (removed.length === 0) {
      return () => undefined;
    }
    this.mutate({ ...this.doc, comments: this.doc.comments.filter((comment) => !removedIds.has(comment.id)) });

    let restored = false;
    return () => {
      if (restored) {
        return;
      }
      restored = true;
      const comments = [...this.doc.comments];
      for (const { comment, index } of removed) {
        comments.splice(Math.min(index, comments.length), 0, comment);
      }
      this.mutate({ ...this.doc, comments });
    };
  }

  reply(parentId: string, body: string): string {
    const parent = this.doc.comments.find((comment) => comment.id === parentId);
    if (!parent) {
      return '';
    }
    const now = new Date().toISOString();
    const id = `l-${randomId()}`;
    this.mutate({
      ...this.doc,
      comments: [
        ...this.doc.comments,
        {
          id,
          parentId,
          path: parent.path,
          side: parent.side,
          line: parent.line,
          startLine: parent.startLine,
          body,
          author: null,
          state: 'draft',
          createdAt: now,
          updatedAt: now,
          codeContext: null,
          outdated: false,
        },
      ],
    });
    return id;
  }

  /** Best effort on `beforeunload`; the browser may end the page before the request finishes. */
  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.hasUnsaved) {
      void this.saveNow();
    }
  }

  retry(): Promise<void> {
    return this.saveNow();
  }

  private mutate(document: ReviewDocument): void {
    this.doc = document;
    this.revision += 1;
    this.status = 'saving';
    this.saveError = null;
    this.changed();
    this.schedule();
  }

  private schedule(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.saveNow();
    }, SAVE_DELAY);
  }

  private async saveNow(): Promise<void> {
    if (this.saving) {
      await this.saving;
      // A debounce may fire while a slow save is still running; save the newer document too.
      if (this.hasUnsaved && this.status !== 'error') {
        await this.saveNow();
      }
      return;
    }
    const revision = this.revision;
    const document = this.doc;
    this.status = 'saving';
    this.saveError = null;
    this.changed();
    const request = apiSend('POST', '/api/reviews/save', { repoId: this.repoId, document }, ReviewDocumentSchema)
      .then((stored) => {
        // Newer edits keep the local document; their debounce schedules the next save.
        if (this.revision === revision) {
          this.doc = stored;
          this.savedRevision = revision;
          this.status = 'saved';
        }
      })
      .catch((reason: unknown) => {
        this.status = 'error';
        this.saveError = message(reason);
      })
      .finally(() => {
        this.saving = null;
        this.changed();
      });
    this.saving = request;
    await request;
  }

  private changed(): void {
    this.version += 1;
    for (const listener of this.listeners) {
      listener();
    }
  }
}

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'Could not save the review';
}

function randomId(): string {
  return typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : Math.random().toString(36).slice(2);
}
