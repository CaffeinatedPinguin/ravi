/**
 * HTTP API contract shared by the server and the UI.
 * Every payload crossing the boundary has a Zod schema here; types are derived from it.
 */
import { z } from 'zod';
import {
  ForgeCapabilitiesSchema,
  ForgeStatusSchema,
  PullRequestSchema,
  PullRequestStateSchema,
  RepoRefSchema,
  ThreadSchema,
} from './forge.ts';
import { NotificationFiltersSchema } from './notify.ts';
import { ImportErrorSchema, ReviewDocumentSchema, ReviewTargetSchema } from './review.ts';

/** Header every mutating request must carry; see `src/server/http/security.ts`. */
export const CSRF_HEADER = 'x-revu';

export const HealthSchema = z.object({
  app: z.literal('revu'),
  version: z.string(),
});
export type Health = z.infer<typeof HealthSchema>;

// ── Settings ────────────────────────────────────────────────────────────────

/**
 * Background notification settings. The filter fields are shared with the preview request, so the
 * rules the UI shows are exactly the rules the poller applies.
 */
export const NotificationSettingsSchema = NotificationFiltersSchema.extend({
  enabled: z.boolean().default(true),
  /** A poll interval short enough to feel live without hammering the forge. */
  pollMinutes: z.number().int().min(1).max(60).default(5),
});
export type NotificationSettings = z.infer<typeof NotificationSettingsSchema>;

/** Parsed here so old settings files (without `notifications`) get every nested default. */
const defaultNotifications = (): NotificationSettings => NotificationSettingsSchema.parse({});

/** Longest branch name a save accepts; matches the settings row hint. */
export const MAX_DEFAULT_BASE_BRANCH = 200;
const FORBIDDEN_BRANCH_CHARS = ['~', '^', ':', '?', '*', '[', '\\'] as const;

/**
 * A branch name typed in Settings later becomes a git argument, so the ref syntax git rejects is
 * refused here. Trimming happens before the checks so `" main "` is stored as `main`.
 */
export const DefaultBaseBranchSchema = z
  .string()
  .transform((value) => value.trim())
  .pipe(
    z
      .string()
      .min(1, 'Enter a branch name.')
      .max(MAX_DEFAULT_BASE_BRANCH, `Use at most ${MAX_DEFAULT_BASE_BRANCH} characters.`)
      .refine((value) => !/\s/.test(value), 'A branch name cannot contain spaces.')
      .refine((value) => !value.startsWith('-'), 'A branch name cannot start with "-".')
      .refine(
        (value) => !value.includes('..') && !FORBIDDEN_BRANCH_CHARS.some((char) => value.includes(char)),
        'A branch name cannot contain "..", "~", "^", ":", "?", "*", "[" or "\\".',
      ),
  );

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
  /** Branch a branch comparison starts from; null means detect the repository default. */
  defaultBaseBranch: DefaultBaseBranchSchema.nullable().default(null),
  notifications: NotificationSettingsSchema.default(defaultNotifications),
});
export type Settings = z.infer<typeof SettingsSchema>;

// The notification payloads live in `notify.ts` (the contract is shared with the poller) but stay
// reachable through `api.ts`, which every route module and the UI already import.
export {
  NotificationFiltersSchema,
  NotificationListSchema,
  NotificationPreviewRequestSchema,
  NotificationPreviewSchema,
  NotificationReadRequestSchema,
  NotificationSchema,
} from './notify.ts';
export type {
  Notification,
  NotificationFilters,
  NotificationList,
  NotificationPreview,
  NotificationPreviewRequest,
  NotificationReadRequest,
} from './notify.ts';

// ── Repositories ────────────────────────────────────────────────────────────

/** How git talks to the forge: the user's own keys, or a token over HTTPS. */
export const RepoTransportSchema = z.enum(['ssh', 'https']);
export type RepoTransport = z.infer<typeof RepoTransportSchema>;
/** Where the token of a repository lives in `~/.revu/.env`. */
export const RepoTokenScopeSchema = z.enum(['repo', 'host']);
export type RepoTokenScope = z.infer<typeof RepoTokenScopeSchema>;

export const RepoSchema = z.object({
  id: z.string(),
  /** Absolute path of the working tree, or of the bare clone for a remote repository. */
  path: z.string(),
  name: z.string(),
  lastUsedAt: z.string(),
  /** Defaults keep `repos.json` files written before remote repositories existed readable. */
  kind: z.enum(['local', 'remote']).default('local'),
  /** Forge repository for a remote clone; local folders fill it from `origin` when connected. */
  remote: RepoRefSchema.nullable().default(null),
  /** Old remotes were cloned over HTTPS, so that is the safe default for a legacy entry. */
  transport: RepoTransportSchema.optional(),
  /** Default to a repository token; the host token is the explicit "use for all" choice. */
  tokenScope: RepoTokenScopeSchema.optional(),
});
export type Repo = z.infer<typeof RepoSchema>;

export const RepoListSchema = z.array(RepoSchema);

/**
 * What the settings screen sees: the stored repository plus masked token state. A token value
 * never crosses this boundary; `tokenHint` is only the last four characters.
 */
export const RepoViewSchema = RepoSchema.extend({
  hasToken: z.boolean(),
  tokenHint: z.string().nullable(),
});
export type RepoView = z.infer<typeof RepoViewSchema>;
export const RepoViewListSchema = z.array(RepoViewSchema);

export const AddRepoRequestSchema = z.object({ path: z.string().min(1) });
/** A repository URL the user pasted; only a registered forge host is accepted. */
export const AddRemoteRepoRequestSchema = z.object({
  url: z.string().min(1).max(2048),
  transport: RepoTransportSchema.default('https'),
  tokenScope: RepoTokenScopeSchema.default('repo'),
  /** Absent means "leave the stored token alone"; null is not sent when adding. */
  token: z.string().min(1).max(512).optional(),
});
export const ScanRequestSchema = z.object({ path: z.string().min(1) });
/** Absolute paths of git working trees found under a folder. */
export const ScanResultSchema = z.array(z.string());
/** Sub-folders of a path, for the folder picker. */
export const DirListSchema = z.object({ path: z.string(), dirs: z.array(z.string()) });
export type DirList = z.infer<typeof DirListSchema>;

/** A token the user typed, or null to remove it. Never echoed back. */
export const TokenInputSchema = z
  .string()
  .min(1)
  .max(512)
  .refine((value) => !/[\r\n]/.test(value), { message: 'A token must be a single line' });

export const RepoConnectionRequestSchema = z.object({
  transport: RepoTransportSchema,
  tokenScope: RepoTokenScopeSchema,
  /** Absent keeps the stored token; null removes the token of the selected scope. */
  token: TokenInputSchema.nullable().optional(),
});
export type RepoConnectionRequest = z.infer<typeof RepoConnectionRequestSchema>;

export const ConnectionCheckSchema = z.object({
  ok: z.boolean(),
  /** Safe to show: git and forge errors are scrubbed of credentials before they get here. */
  message: z.string(),
});
export type ConnectionCheck = z.infer<typeof ConnectionCheckSchema>;

export const ApiConnectionCheckSchema = ConnectionCheckSchema.extend({
  /** Login the token belongs to, when the forge answered. */
  user: z.string().optional(),
});
export type ApiConnectionCheck = z.infer<typeof ApiConnectionCheckSchema>;

export const TestConnectionResponseSchema = z.object({
  git: ConnectionCheckSchema,
  api: ApiConnectionCheckSchema,
});
export type TestConnectionResponse = z.infer<typeof TestConnectionResponseSchema>;

/** Host token state for the Accounts section; `tokenHint` is only the last four characters. */
export const ForgeStatusViewSchema = ForgeStatusSchema.extend({
  tokenHint: z.string().nullable(),
});
export type ForgeStatusView = z.infer<typeof ForgeStatusViewSchema>;
export const ForgeStatusViewListSchema = z.array(ForgeStatusViewSchema);

export const ForgeTokenRequestSchema = z.object({ token: TokenInputSchema.nullable() });
export type ForgeTokenRequest = z.infer<typeof ForgeTokenRequestSchema>;

/** The system folder dialog answers a path, or null when the user cancelled. */
export const PickFolderResponseSchema = z.object({ path: z.string().nullable() });
export type PickFolderResponse = z.infer<typeof PickFolderResponseSchema>;

export const RepoInfoSchema = z.object({
  branch: z.string().nullable(),
  defaultBranch: z.string().nullable(),
  branches: z.array(z.string()),
});
export type RepoInfo = z.infer<typeof RepoInfoSchema>;

/** One row of the ref picker; the subject makes a commit searchable by what it changed. */
export const RefCommitSchema = z.object({
  sha: z.string(),
  shortSha: z.string(),
  subject: z.string(),
  date: z.string(),
});
export type RefCommit = z.infer<typeof RefCommitSchema>;

/** Everything a review can start from: refs are grouped so the picker can show headings. */
export const RefsSchema = z.object({
  branches: z.array(z.string()),
  remoteBranches: z.array(z.string()),
  tags: z.array(z.string()),
  commits: z.array(RefCommitSchema),
});
export type Refs = z.infer<typeof RefsSchema>;

// ── Remote clones ───────────────────────────────────────────────────────────

export const CloneInfoSchema = z.object({
  repoId: z.string(),
  host: z.string(),
  project: z.string(),
  /** Size on disk, computed by walking the clone folder; a missing folder reports 0. */
  sizeBytes: z.number().int().nonnegative(),
  lastUsedAt: z.string(),
});
export type CloneInfo = z.infer<typeof CloneInfoSchema>;
export const CloneInfoListSchema = z.array(CloneInfoSchema);

/** When a refresh finished; the UI shows a pending state until then. */
export const FetchResponseSchema = z.object({ fetchedAt: z.string() });
export type FetchResponse = z.infer<typeof FetchResponseSchema>;

/** Commit the pull request head was fetched at. */
export const PullRequestFetchResponseSchema = z.object({ headSha: z.string() });
export type PullRequestFetchResponse = z.infer<typeof PullRequestFetchResponseSchema>;

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

// ── Pull requests ───────────────────────────────────────────────────────────

/** Query of the pull request list; mirrors the UI toggles. */
export const PullRequestListQuerySchema = z.object({
  state: z.enum(['open', 'all']).default('open'),
  mine: z.boolean().default(false),
});
export type PullRequestListQuery = z.infer<typeof PullRequestListQuerySchema>;

/** Everything the review screen needs when opening a pull request. */
export const PullRequestOpenSchema = z.object({
  pullRequest: PullRequestSchema,
  /** Three-dot comparison, like the forge's "Files changed" view. */
  diffTarget: DiffTargetSchema,
  diffSummary: DiffSummarySchema,
  threads: z.array(ThreadSchema),
  capabilities: ForgeCapabilitiesSchema,
  currentUser: z.string(),
  reviewTarget: ReviewTargetSchema,
  /** Non-fatal surprises, e.g. the head moved between the forge call and the git fetch. */
  warnings: z.array(z.string()),
});
export type PullRequestOpen = z.infer<typeof PullRequestOpenSchema>;

/** Cheap "did this pull request change?" answer for the open review banner. */
export const PullRequestStatusSchema = z.object({
  headSha: z.string(),
  state: PullRequestStateSchema,
  updatedAt: z.string(),
});
export type PullRequestStatus = z.infer<typeof PullRequestStatusSchema>;

// ── Review later ────────────────────────────────────────────────────────────

/** The last status seen for a stored pull request; null until a refresh succeeded. */
export const ReviewLaterLastKnownSchema = z.object({
  headSha: z.string(),
  state: PullRequestStateSchema,
  updatedAt: z.string(),
  checkedAt: z.string(),
});
export type ReviewLaterLastKnown = z.infer<typeof ReviewLaterLastKnownSchema>;

/** What is written to `data/review-later.json`; derived fields are computed, never stored. */
export const ReviewLaterStoredSchema = z.object({
  repoId: z.string().min(1),
  number: z.number().int().positive(),
  title: z.string(),
  addedAt: z.string(),
  /** Head at the moment it was added, so a force-push is visible even after a restart. */
  headShaAtAdd: z.string(),
  lastKnown: ReviewLaterLastKnownSchema.nullable(),
});
export type ReviewLaterStored = z.infer<typeof ReviewLaterStoredSchema>;

export const ReviewLaterEntrySchema = ReviewLaterStoredSchema.extend({
  /** The head differs from the one that was added. */
  changedSinceAdded: z.boolean(),
  /** The last known state is no longer open. */
  closed: z.boolean(),
  /** Why the last refresh could not reach the forge; the previous `lastKnown` is kept. */
  error: z.string().optional(),
});
export type ReviewLaterEntry = z.infer<typeof ReviewLaterEntrySchema>;
export const ReviewLaterListSchema = z.array(ReviewLaterEntrySchema);

export const ReviewLaterAddRequestSchema = z.object({
  repoId: z.string().min(1),
  number: z.number().int().positive(),
});
export type ReviewLaterAddRequest = z.infer<typeof ReviewLaterAddRequestSchema>;

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
