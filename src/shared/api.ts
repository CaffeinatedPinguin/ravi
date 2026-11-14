/**
 * HTTP API contract shared by the server and the UI.
 * Every payload crossing the boundary has a Zod schema here; types are derived from it.
 */
import { z } from 'zod';
import { ImportErrorSchema, ReviewDocumentSchema, ReviewTargetSchema } from './review.ts';

/** Header every mutating request must carry; see `src/server/http/security.ts`. */
export const CSRF_HEADER = 'x-revu';

export const HealthSchema = z.object({
  app: z.literal('revu'),
  version: z.string(),
});
export type Health = z.infer<typeof HealthSchema>;

// ── Settings ────────────────────────────────────────────────────────────────

export const SettingsSchema = z.object({
  viewMode: z.enum(['split', 'unified']).default('unified'),
  ignoreWhitespace: z.boolean().default(false),
  showUntracked: z.boolean().default(true),
  /** What file and comment links point at: the forge URL or the local file path. */
  linkMode: z.enum(['url', 'path']).default('path'),
  /** Lines revealed by one click on a hunk expander. */
  expandStep: z.number().int().min(1).max(500).default(20),
  theme: z.enum(['system', 'light', 'dark']).default('system'),
  treeWidth: z.number().int().min(160).max(800).default(300),
  /** Unused partial clones older than this are removed on startup. */
  cloneRetentionDays: z.number().int().min(1).max(3650).default(30),
});
export type Settings = z.infer<typeof SettingsSchema>;

// ── Repositories ────────────────────────────────────────────────────────────

export const RepoSchema = z.object({
  id: z.string(),
  /** Absolute path of the working tree. */
  path: z.string(),
  name: z.string(),
  lastUsedAt: z.string(),
});
export type Repo = z.infer<typeof RepoSchema>;

export const RepoListSchema = z.array(RepoSchema);
export const AddRepoRequestSchema = z.object({ path: z.string().min(1) });
export const ScanRequestSchema = z.object({ path: z.string().min(1) });
/** Absolute paths of git working trees found under a folder. */
export const ScanResultSchema = z.array(z.string());
/** Sub-folders of a path, for the folder picker. */
export const DirListSchema = z.object({ path: z.string(), dirs: z.array(z.string()) });
export type DirList = z.infer<typeof DirListSchema>;

export const RepoInfoSchema = z.object({
  branch: z.string().nullable(),
  defaultBranch: z.string().nullable(),
  branches: z.array(z.string()),
});
export type RepoInfo = z.infer<typeof RepoInfoSchema>;

// ── Diff ────────────────────────────────────────────────────────────────────

/** What is being compared. The server turns it into git arguments and two revisions. */
export const DiffTargetSchema = z.discriminatedUnion('kind', [
  /** Everything not committed yet: HEAD against the working tree. */
  z.object({ kind: z.literal('uncommitted') }),
  /** Index against the working tree. */
  z.object({ kind: z.literal('unstaged') }),
  /** HEAD against the index. */
  z.object({ kind: z.literal('staged') }),
  /** What the current branch adds on top of `base` (merge-base to HEAD). */
  z.object({ kind: z.literal('branch'), base: z.string().min(1) }),
  /** Two commits or refs; `mergeBase` compares from their common ancestor, like a pull request. */
  z.object({ kind: z.literal('range'), from: z.string().min(1), to: z.string().min(1), mergeBase: z.boolean().default(false) }),
]);
export type DiffTarget = z.infer<typeof DiffTargetSchema>;

export const DiffOptionsSchema = z.object({
  target: DiffTargetSchema,
  ignoreWhitespace: z.boolean().default(false),
  includeUntracked: z.boolean().default(false),
});
export type DiffOptions = z.infer<typeof DiffOptionsSchema>;

export const FileStatusSchema = z.enum(['added', 'modified', 'deleted', 'renamed', 'copied', 'untracked']);
export type FileStatus = z.infer<typeof FileStatusSchema>;

export const DiffFileSchema = z.object({
  path: z.string(),
  /** Previous path for renames and copies. */
  oldPath: z.string().nullable(),
  status: FileStatusSchema,
  additions: z.number().int(),
  deletions: z.number().int(),
  binary: z.boolean(),
});
export type DiffFile = z.infer<typeof DiffFileSchema>;

export const DiffSummarySchema = z.object({
  files: z.array(DiffFileSchema),
  additions: z.number().int(),
  deletions: z.number().int(),
});
export type DiffSummary = z.infer<typeof DiffSummarySchema>;

export const PatchesRequestSchema = DiffOptionsSchema.extend({
  /** Files whose patches are wanted; kept small because they travel as git arguments. */
  files: z.array(z.object({ path: z.string(), oldPath: z.string().nullable(), status: FileStatusSchema })).max(100),
});
export type PatchesRequest = z.infer<typeof PatchesRequestSchema>;

/** Raw unified diff text per file path; a missing key means git produced no patch for it. */
export const PatchesSchema = z.record(z.string(), z.string());
export type Patches = z.infer<typeof PatchesSchema>;

export const FingerprintRequestSchema = z.object({ target: DiffTargetSchema });
export type FingerprintRequest = z.infer<typeof FingerprintRequestSchema>;

/** A value that changes when the reviewed state changes; the UI compares it before reloading. */
export const FingerprintSchema = z.object({ fingerprint: z.string() });
export type Fingerprint = z.infer<typeof FingerprintSchema>;

export const BlobRequestSchema = z.object({
  target: DiffTargetSchema,
  side: z.enum(['old', 'new']),
  path: z.string().min(1),
});

/** Whole file content at one side of the diff, for expanding context. */
export const BlobSchema = z.object({ lines: z.array(z.string()) });
export type Blob = z.infer<typeof BlobSchema>;

// ── Review comments ─────────────────────────────────────────────────────────

/** Limits from the contract; enforced here so a broken UI cannot store an unbounded review. */
export const MAX_COMMENT_BODY_BYTES = 64 * 1024;
export const MAX_REVIEW_COMMENTS = 5000;
export const MAX_ASSET_BYTES = 10 * 1024 * 1024;

const utf8Length = (value: string): number => new TextEncoder().encode(value).length;

/**
 * The review model with the per-comment limits applied. `src/shared/review.ts` stays the single
 * definition of the model; this only adds the request-side caps.
 */
export const ReviewDocumentInputSchema = ReviewDocumentSchema.superRefine((document, context) => {
  if (document.comments.length > MAX_REVIEW_COMMENTS) {
    context.addIssue({ code: 'custom', message: `A review has at most ${MAX_REVIEW_COMMENTS} comments`, path: ['comments'] });
  }
  document.comments.forEach((comment, index) => {
    if (utf8Length(comment.body) > MAX_COMMENT_BODY_BYTES) {
      context.addIssue({ code: 'custom', message: `Comment body is larger than ${MAX_COMMENT_BODY_BYTES} bytes`, path: ['comments', index, 'body'] });
    }
  });
});
export type ReviewDocumentInput = z.infer<typeof ReviewDocumentInputSchema>;

/** Repository ids are derived from a path; anything else could not name a stored review. */
const RepoIdSchema = z.string().regex(/^[a-f0-9]{8,64}$/);

export const ReviewLoadRequestSchema = z.object({ repoId: RepoIdSchema, target: ReviewTargetSchema });
export type ReviewLoadRequest = z.infer<typeof ReviewLoadRequestSchema>;
/** Both load and save answer with the stored document; the model schema is the contract. */
export const ReviewLoadResponseSchema = ReviewDocumentSchema;
export const ReviewSaveResponseSchema = ReviewDocumentSchema;
export type ReviewLoadResponse = z.infer<typeof ReviewLoadResponseSchema>;
export type ReviewSaveResponse = z.infer<typeof ReviewSaveResponseSchema>;

export const ReviewSaveRequestSchema = z.object({ repoId: RepoIdSchema, document: ReviewDocumentInputSchema });
export type ReviewSaveRequest = z.infer<typeof ReviewSaveRequestSchema>;

export const ReviewExportRequestSchema = z.object({
  repoId: RepoIdSchema,
  diffTarget: DiffTargetSchema,
  document: ReviewDocumentInputSchema,
});
export type ReviewExportRequest = z.infer<typeof ReviewExportRequestSchema>;
export const ReviewExportResponseSchema = z.object({ markdown: z.string() });
export type ReviewExportResponse = z.infer<typeof ReviewExportResponseSchema>;

export const ReviewReportSchema = z.object({
  added: z.number().int().nonnegative(),
  edited: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  errors: z.array(ImportErrorSchema),
});
export type ReviewReport = z.infer<typeof ReviewReportSchema>;

export const ReviewImportRequestSchema = z.object({
  repoId: RepoIdSchema,
  diffTarget: DiffTargetSchema,
  document: ReviewDocumentInputSchema,
  markdown: z.string(),
});
export type ReviewImportRequest = z.infer<typeof ReviewImportRequestSchema>;
export const ReviewImportResponseSchema = z.object({ document: ReviewDocumentSchema, report: ReviewReportSchema });
export type ReviewImportResponse = z.infer<typeof ReviewImportResponseSchema>;

// ── Comment images ──────────────────────────────────────────────────────────

export const AssetTypeSchema = z.enum(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
export type AssetType = z.infer<typeof AssetTypeSchema>;

/** The only shape that may ever be used as a file name under `data/assets`. */
export const ASSET_ID_PATTERN = /^[a-f0-9]{64}\.(?:png|jpg|gif|webp)$/;

export const AssetUploadRequestSchema = z.object({
  name: z.string().min(1).max(255),
  type: AssetTypeSchema,
  dataBase64: z.string().min(1),
});
export type AssetUploadRequest = z.infer<typeof AssetUploadRequestSchema>;
export const AssetUploadResponseSchema = z.object({ id: z.string() });
export type AssetUploadResponse = z.infer<typeof AssetUploadResponseSchema>;
