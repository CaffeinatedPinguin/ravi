/**
 * Forge contract shared by the server and the UI.
 *
 * The model is deliberately forge-neutral: a `RepoRef` names a repository on one host, a
 * `PullRequest` is the subset of fields both GitHub and GitLab can provide, and every capability
 * that differs between forges is a boolean in `ForgeCapabilities` instead of a brand check.
 */
import { z } from 'zod';
import { CommentSideSchema, ReviewActionSchema } from './review.ts';

export { CommentSideSchema, ReviewActionSchema };
export type { CommentSide } from './review.ts';

// ── Repository ──────────────────────────────────────────────────────────────

export const ForgeKindSchema = z.enum(['github', 'gitlab']);
/** Which forge API speaks to a host. New forges add a member; callers must not branch on it. */
export type ForgeKind = z.infer<typeof ForgeKindSchema>;

export const RepoRefSchema = z.object({
  /** Registry host, e.g. `github.com`; never includes a port or a user. */
  host: z.string().min(1),
  /** Project path: `owner/name` on GitHub, the full group path on GitLab (`group/sub/name`). */
  project: z.string().min(1),
});
export type RepoRef = z.infer<typeof RepoRefSchema>;

// ── Capabilities ────────────────────────────────────────────────────────────

export const ForgeCapabilitiesSchema = z.object({
  /** Whether an image can be uploaded through the forge API rather than committed to the repository. */
  imageUpload: z.boolean(),
  /** Whether a review can be submitted with the "request changes" verdict. */
  requestChanges: z.boolean(),
  /** Whether pull request comments can have replies in threads. */
  threadedPrComments: z.boolean(),
  /** Whether a review thread can be marked resolved. */
  resolveThreads: z.boolean(),
});
export type ForgeCapabilities = z.infer<typeof ForgeCapabilitiesSchema>;

// ── Pull requests ───────────────────────────────────────────────────────────

export const PullRequestStateSchema = z.enum(['open', 'closed', 'merged']);
/** Lifecycle state reported by the forge. */
export type PullRequestState = z.infer<typeof PullRequestStateSchema>;

export const PullRequestSummarySchema = z.object({
  /** Forge-assigned number, stable for the life of the pull request. */
  number: z.number().int().positive(),
  /** Title as shown on the forge. */
  title: z.string(),
  /** Login of the author. */
  author: z.string(),
  /** Open, closed without merge, or merged. */
  state: PullRequestStateSchema,
  /** Whether the pull request is still a draft. */
  draft: z.boolean(),
  /** ISO timestamp of the last change on the forge. */
  updatedAt: z.string(),
  /** Branch the pull request targets. */
  baseRef: z.string(),
  /** Branch that contains the proposed change. */
  headRef: z.string(),
  /** Commit at the tip of `headRef`. */
  headSha: z.string(),
  /** Canonical browser URL of the pull request. */
  webUrl: z.string(),
  /** Number of comments, or null when the forge does not report it cheaply. */
  commentCount: z.number().int().nonnegative().nullable(),
});
export type PullRequestSummary = z.infer<typeof PullRequestSummarySchema>;

export const PullRequestSchema = PullRequestSummarySchema.extend({
  /** Markdown description written by the author. */
  body: z.string(),
  /** Commit the pull request is based on. */
  baseSha: z.string(),
  /** Commit at the tip of `headRef`; repeated here because callers compare it with `mergeBaseSha`. */
  headSha: z.string(),
  /** Common ancestor used for the diff, or null when the forge cannot compute it. */
  mergeBaseSha: z.string().nullable(),
});
export type PullRequest = z.infer<typeof PullRequestSchema>;

// ── Review threads ──────────────────────────────────────────────────────────

export const RemoteCommentSchema = z.object({
  /** Forge-assigned comment id. */
  id: z.string(),
  /** Login of the author. */
  author: z.string(),
  /** Comment text in Markdown. */
  body: z.string(),
  /** ISO timestamp of creation. */
  createdAt: z.string(),
  /** ISO timestamp of the last edit. */
  updatedAt: z.string(),
  /** Whether the user holding the token may edit this comment. */
  canEdit: z.boolean(),
});
export type RemoteComment = z.infer<typeof RemoteCommentSchema>;

export const ThreadSchema = z.object({
  /** Forge-assigned thread id. */
  id: z.string(),
  /** Repository-relative path, or null for a comment on the whole pull request. */
  path: z.string().nullable(),
  /** Version of the file the line numbers refer to. */
  side: CommentSideSchema,
  /** 1-based line in that side's file, or null for a review-level comment. */
  line: z.number().int().positive().nullable(),
  /** First line of the commented range, or null for one line. */
  startLine: z.number().int().positive().nullable(),
  /** True when the commented code no longer exists at that position. */
  outdated: z.boolean(),
  /** True when the thread was resolved on the forge. */
  resolved: z.boolean(),
  /** Comments in display order; replies follow their parent. */
  comments: z.array(RemoteCommentSchema),
});
export type Thread = z.infer<typeof ThreadSchema>;

// ── Sending drafts ──────────────────────────────────────────────────────────

/** Review-level verdict sent together with the drafts. */
export type ReviewAction = z.infer<typeof ReviewActionSchema>;

export const DraftOperationSchema = z.discriminatedUnion('op', [
  z.object({
    /** Marks a new inline comment. */
    op: z.literal('comment'),
    /** Local draft id; the forge never sees it. */
    draftId: z.string().min(1),
    /** Repository-relative path the comment points at. */
    path: z.string().min(1),
    /** Version of the file the line numbers refer to. */
    side: CommentSideSchema,
    /** 1-based line the comment ends on. */
    line: z.number().int().positive(),
    /** First line of the range, or null for a single line. */
    startLine: z.number().int().positive().nullable(),
    /** Comment text in Markdown. */
    body: z.string(),
  }),
  z.object({
    /** Marks a reply to an existing thread. */
    op: z.literal('reply'),
    /** Local draft id; the forge never sees it. */
    draftId: z.string().min(1),
    /** Thread being answered. */
    threadId: z.string().min(1),
    /** Reply text in Markdown. */
    body: z.string(),
  }),
  z.object({
    /** Marks a comment on the pull request as a whole. */
    op: z.literal('prComment'),
    /** Local draft id; the forge never sees it. */
    draftId: z.string().min(1),
    /** Comment text in Markdown. */
    body: z.string(),
  }),
  z.object({
    /** Marks an edit of a published comment. */
    op: z.literal('edit'),
    /** Local draft id; the forge never sees it. */
    draftId: z.string().min(1),
    /** Forge comment being edited. */
    commentId: z.string().min(1),
    /** Replacement text in Markdown. */
    body: z.string(),
  }),
  z.object({
    /** Marks a deletion of a published comment. */
    op: z.literal('delete'),
    /** Local draft id; the forge never sees it. */
    draftId: z.string().min(1),
    /** Forge comment being deleted. */
    commentId: z.string().min(1),
  }),
]);
export type DraftOperation = z.infer<typeof DraftOperationSchema>;

export const SubmitResultSchema = z.object({
  /** Local draft id the result belongs to. */
  draftId: z.string(),
  /** False when this one operation failed; the others still ran. */
  ok: z.boolean(),
  /** Forge id of the created or edited object. */
  remoteId: z.string().optional(),
  /** Human-readable failure reason; never contains a token. */
  error: z.string().optional(),
});
export type SubmitResult = z.infer<typeof SubmitResultSchema>;

// ── Status ──────────────────────────────────────────────────────────────────

export const ForgeStatusSchema = z.object({
  /** Registry host, e.g. `github.com`. */
  host: z.string(),
  /** Strategy that handles the host. */
  kind: ForgeKindSchema,
  /** Whether a token for this host exists in `~/.revu/.env`; the token itself never leaves the server. */
  hasToken: z.boolean(),
  /** Base browser URL of the host. */
  webUrl: z.string(),
});
export type ForgeStatus = z.infer<typeof ForgeStatusSchema>;
