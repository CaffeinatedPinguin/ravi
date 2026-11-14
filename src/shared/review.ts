/**
 * The review comment model and the import result.
 *
 * A review is one document per target: the comments (drafts and published ones), an optional
 * review-level summary and the action the user intends to send. The Markdown codec in
 * `src/server/review/markdown.ts` is a lossless view of this model except for the fields that only
 * matter locally (`state`, timestamps, `codeContext`, `outdated`).
 */
import { z } from 'zod';

export const CommentSideSchema = z.enum(['new', 'old']);
/** Which version of the file a comment points at. */
export type CommentSide = z.infer<typeof CommentSideSchema>;

export const CommentStateSchema = z.enum(['draft', 'published']);
/** Whether a comment exists only in revu or already on the forge. */
export type CommentState = z.infer<typeof CommentStateSchema>;

export const ReviewActionSchema = z.enum(['comment', 'approve', 'requestChanges']);
/** Review-level action sent together with the comments. */
export type ReviewAction = z.infer<typeof ReviewActionSchema>;

const ReviewCommentFields = {
  /** Stable id: `l-` + random while local, the forge's plain id once published. */
  id: z.string().min(1),
  /** Comment this one replies to, or null for a top-level comment. */
  parentId: z.string().nullable(),
  /** Repository-relative path; null for a comment on the whole review. */
  path: z.string().nullable(),
  /** Version of the file the line numbers refer to. */
  side: CommentSideSchema,
  /** 1-based line in that side's file, or null for a review-level comment. */
  line: z.number().int().positive().nullable(),
  /** First line of the commented range (never greater than `line`), or null for one line. */
  startLine: z.number().int().positive().nullable(),
  /** Comment text in Markdown. */
  body: z.string(),
  /** Author name once known (published or imported); null for an anonymous local draft. */
  author: z.string().nullable(),
  /** Whether the comment is still local or already exists on the forge. */
  state: CommentStateSchema,
  /** ISO timestamp of creation. */
  createdAt: z.string(),
  /** ISO timestamp of the last edit. */
  updatedAt: z.string(),
  /** Quoted code lines exported next to the comment; never imported. */
  codeContext: z.string().nullable(),
  /** True when the forge reports the commented code as no longer present. */
  outdated: z.boolean(),
  /**
   * Forge thread this draft answers. A reply is only possible once the parent exists on the forge;
   * a reply to another local draft is folded into the parent's body instead (see `outbox.ts`).
   */
  remoteThreadId: z.string().nullable().optional(),
  /** Forge comment an edit or delete targets; null unless `pendingAction` is set. */
  remoteCommentId: z.string().nullable().optional(),
  /** Local intent to change an existing remote comment instead of adding a new one. */
  pendingAction: z.enum(['edit', 'delete']).nullable().optional(),
  /** Why the last send of this draft failed, so the UI can offer a retry; null otherwise. */
  sendError: z.string().nullable().optional(),
};

/**
 * The send fields are optional so a document written before they existed still parses; every
 * reader treats a missing value like `null`.
 */
export const ReviewCommentSchema = z.object(ReviewCommentFields);
export type ReviewComment = z.infer<typeof ReviewCommentSchema>;

export const ReviewTargetSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('local'),
    /** Absolute path of the working tree. */
    repoPath: z.string(),
    /** Encoded diff target such as `uncommitted`, `branch:main` or `range:a..b`. */
    target: z.string(),
  }),
  z.object({
    kind: z.literal('pullRequest'),
    /** Forge host, e.g. `github.com`. */
    host: z.string(),
    /** Project path on the forge, e.g. `acme/api`. */
    project: z.string(),
    /** Pull request or merge request number. */
    number: z.number().int().positive(),
    /** Which forge API the pull request belongs to. */
    forge: z.enum(['github', 'gitlab']),
  }),
]);
export type ReviewTarget = z.infer<typeof ReviewTargetSchema>;

export const ReviewDocumentSchema = z.object({
  /** Format version of this model; a breaking change bumps it. */
  version: z.literal(1),
  /** What was reviewed. */
  target: ReviewTargetSchema,
  /** Base commit the review is anchored to, if known. */
  baseSha: z.string().nullable(),
  /** Head commit the review is anchored to, if known. */
  headSha: z.string().nullable(),
  /** Review-level action the user chose, if any. */
  action: ReviewActionSchema.nullable(),
  /** Review-level summary Markdown, if any. */
  summary: z.string().nullable(),
  /** Every comment of the review, drafts included. */
  comments: z.array(ReviewCommentSchema),
});
export type ReviewDocument = z.infer<typeof ReviewDocumentSchema>;

/**
 * A comment read from Markdown. The text carries no local state and may carry no id (a hand-written
 * comment), so the caller assigns ids and parent links that are missing.
 */
export const ImportedCommentSchema = z.object(ReviewCommentFields).omit({
  state: true,
  createdAt: true,
  updatedAt: true,
  codeContext: true,
  outdated: true,
  // Send bookkeeping never comes from Markdown; the codec is a lossless view of the review text.
  remoteThreadId: true,
  remoteCommentId: true,
  pendingAction: true,
  sendError: true,
}).extend({
  /** Forge id when the export had one; null when the caller must assign a local id. */
  id: z.string().nullable(),
});
export type ImportedComment = z.infer<typeof ImportedCommentSchema>;

export const ImportErrorSchema = z.object({
  /** 1-based line number in the imported text. */
  line: z.number().int().positive(),
  /** What could not be read. */
  message: z.string(),
});
export type ImportError = z.infer<typeof ImportErrorSchema>;

/** Review-level fields readable from an export; the target is chosen by the caller, not the text. */
export const ImportedDocumentSchema = z.object({
  version: z.literal(1),
  baseSha: z.string().nullable(),
  headSha: z.string().nullable(),
  action: ReviewActionSchema.nullable(),
  summary: z.string().nullable(),
});
export type ImportedDocument = z.infer<typeof ImportedDocumentSchema>;

export const ImportResultSchema = z.object({
  /** Header and summary of the imported text, without a target. */
  document: ImportedDocumentSchema,
  /** Comments in file order; replies refer to the id above them or have a null parent. */
  comments: z.array(ImportedCommentSchema),
  /** Sections that could not be read; they are skipped, the rest is kept. */
  errors: z.array(ImportErrorSchema),
});
export type ImportResult = z.infer<typeof ImportResultSchema>;
