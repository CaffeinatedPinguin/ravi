/**
 * GitLab.com strategy.
 *
 * GitLab speaks "merge requests" and "discussions"; the shared model calls both pull requests and
 * threads. The quirks that drive the code below:
 * - `submit` writes draft notes and publishes them with one `bulk_publish`, so the author gets one
 *   notification instead of one per comment. "Request changes" is a `reviewer_state`, not a review
 *   event, and approving is a separate endpoint that needs the current head SHA.
 * - A draft note needs a diff position whose old/new line shape depends on the kind of line. A
 *   context line needs both numbers even when they differ; the outbox therefore fills `oldLine`
 *   and `newLine` from the diff row, and only falls back to `side` + `line` when both are absent.
 * - `ForgeHttp` has no multipart helper and does not expose its auth headers, so uploads are a
 *   small raw-fetch helper here; the registry wires the auth callback through factory options.
 */
import { z } from 'zod';
import type {
  CommentSide,
  DraftOperation,
  PullRequest,
  PullRequestSummary,
  RepoRef,
  ReviewAction,
  SubmitResult,
  Thread,
} from '../../shared/forge.ts';
import type { Forge, ForgeHost, ListPullRequestsOptions } from './forge.ts';
import type { FetchLike, ForgeHttp } from './http.ts';
import { ForgeError } from './http.ts';
import { fileWebUrl } from './urls.ts';

const REQUEST_TIMEOUT_MS = 20_000;

/** Optional dependencies the registry wires in; the strategy never holds a token itself. */
export type GitLabForgeOptions = {
  /** Reads an image attached to a draft body (`asset:<id>`); bound to `data/assets` by the registry. */
  readAsset?: (id: string) => Promise<{ data: Uint8Array; type: string }>;
  /** Adds GitLab's auth header to the raw multipart upload; `ForgeHttp` does not expose it. */
  auth?: (headers: Headers) => void;
  /** Fetch used for multipart uploads; overridable so tests never touch the network. */
  fetchImpl?: FetchLike;
};

const AuthorSchema = z.object({ username: z.string() });

const DiffRefsSchema = z.object({
  base_sha: z.string(),
  head_sha: z.string(),
  start_sha: z.string(),
});

const MergeRequestSchema = z.object({
  iid: z.number().int(),
  title: z.string(),
  description: z.string().nullable().optional(),
  author: AuthorSchema,
  state: z.string(),
  draft: z.boolean().optional(),
  updated_at: z.string(),
  source_branch: z.string(),
  target_branch: z.string(),
  sha: z.string(),
  web_url: z.string(),
  user_notes_count: z.number().int().nullable().optional(),
  diff_refs: DiffRefsSchema.nullable().optional(),
});
type MergeRequest = z.infer<typeof MergeRequestSchema>;

const RangePointSchema = z.object({
  type: z.string().optional(),
  old_line: z.number().int().nullable().optional(),
  new_line: z.number().int().nullable().optional(),
});

const PositionSchema = z.object({
  base_sha: z.string().optional(),
  start_sha: z.string().optional(),
  head_sha: z.string().optional(),
  old_path: z.string().optional(),
  new_path: z.string().optional(),
  position_type: z.string().optional(),
  old_line: z.number().int().nullable().optional(),
  new_line: z.number().int().nullable().optional(),
  line_range: z
    .object({ start: RangePointSchema.optional(), end: RangePointSchema.optional() })
    .nullable()
    .optional(),
});

const NoteSchema = z.object({
  id: z.number().int(),
  body: z.string().nullable().optional(),
  author: AuthorSchema.nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
  system: z.boolean().optional(),
  resolvable: z.boolean().optional(),
  resolved: z.boolean().optional(),
  position: PositionSchema.nullable().optional(),
});
type Note = z.infer<typeof NoteSchema>;

const DiscussionSchema = z.object({
  id: z.string(),
  notes: z.array(NoteSchema),
});

const UserSchema = z.object({ username: z.string() });
const UploadSchema = z.object({ markdown: z.string() });
const DraftNoteSchema = z.object({ id: z.number().int() });

type DiffRefs = { baseSha: string; headSha: string; startSha: string };
type LinePair = { old_line?: number; new_line?: number };
type UploadedAsset = { markdown: string } | { error: string };

const ASSET_LINK = /!\[([^\]]*)\]\(asset:([^)\s]+)\)/g;

export function createGitLabForge(host: ForgeHost, http: ForgeHttp, options: GitLabForgeOptions = {}): Forge {
  const refsCache = new Map<string, DiffRefs>();
  let userPromise: Promise<string> | null = null;

  const apiBase = host.apiUrl.replace(/\/+$/, '');
  const apiOrigin = new URL(apiBase).origin;

  const mergeRequests = (repo: RepoRef): string => `/projects/${encodeURIComponent(repo.project)}/merge_requests`;
  const requestPath = (repo: RepoRef, number: number): string => `${mergeRequests(repo)}/${number}`;
  const refKey = (repo: RepoRef, number: number): string => `${repo.project}#${number}`;

  const readMergeRequest = (repo: RepoRef, number: number): Promise<MergeRequest> =>
    http.get(requestPath(repo, number), MergeRequestSchema);

  function rememberRefs(repo: RepoRef, number: number, mr: MergeRequest): void {
    if (mr.diff_refs === null || mr.diff_refs === undefined) {
      return;
    }
    refsCache.set(refKey(repo, number), {
      baseSha: mr.diff_refs.base_sha,
      headSha: mr.diff_refs.head_sha,
      startSha: mr.diff_refs.start_sha,
    });
  }

  /**
   * Positions need `start_sha`, which is not part of the shared `PullRequest`. `getPullRequest`
   * caches it; a submit that arrives without that cache re-reads the merge request once.
   */
  async function ensureRefs(repo: RepoRef, number: number): Promise<DiffRefs> {
    const cached = refsCache.get(refKey(repo, number));
    if (cached !== undefined) {
      return cached;
    }
    const mr = await readMergeRequest(repo, number);
    rememberRefs(repo, number, mr);
    const refs = refsCache.get(refKey(repo, number));
    if (refs === undefined) {
      throw new ForgeError(502, 'Merge request has no diff refs');
    }
    return refs;
  }

  async function currentUser(): Promise<string> {
    userPromise ??= http.get('/user', UserSchema).then((user) => user.username);
    return userPromise;
  }

  /** Uploads one `asset:<id>`; the returned Markdown replaces the local link in the body. */
  async function uploadAsset(repo: RepoRef, id: string, asset: { data: Uint8Array; type: string }): Promise<string> {
    const url = `${apiBase}/projects/${encodeURIComponent(repo.project)}/uploads`;
    if (new URL(url).origin !== apiOrigin) {
      throw new ForgeError(400, 'Upload leaves the API host');
    }
    const headers = new Headers({ accept: 'application/json' });
    options.auth?.(headers);

    // Copy into a plain ArrayBuffer-backed view: a Buffer may be backed by a SharedArrayBuffer,
    // which is not a valid BlobPart.
    const bytes = new Uint8Array(asset.data.byteLength);
    bytes.set(asset.data);
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: asset.type }), id);

    let response: Response;
    try {
      response = await (options.fetchImpl ?? fetch)(url, {
        method: 'POST',
        headers,
        body: form,
        redirect: 'manual',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      // The URL is ours; the message never includes the auth header.
      throw new ForgeError(502, `Cannot reach ${host.host}: ${errorText(error)}`);
    }

    if (response.status >= 300 && response.status < 400) {
      throw new ForgeError(response.status, `Refusing to follow a redirect (${response.status})`);
    }
    if (!response.ok) {
      throw new ForgeError(response.status, await safeResponseMessage(response, headers));
    }
    const parsed = UploadSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new ForgeError(502, 'Unexpected upload response from the forge');
    }
    return parsed.data.markdown;
  }

  async function uploadAssets(repo: RepoRef, drafts: readonly DraftOperation[]): Promise<Map<string, UploadedAsset>> {
    const ids = new Set<string>();
    for (const draft of drafts) {
      const body = 'body' in draft ? draft.body : null;
      if (body === null) {
        continue;
      }
      for (const match of body.matchAll(ASSET_LINK)) {
        const id = match[2];
        if (id !== undefined) {
          ids.add(id);
        }
      }
    }

    const uploaded = new Map<string, UploadedAsset>();
    for (const id of ids) {
      try {
        if (options.readAsset === undefined) {
          throw new ForgeError(400, 'Image uploads are not configured');
        }
        const asset = await options.readAsset(id);
        uploaded.set(id, { markdown: await uploadAsset(repo, id, asset) });
      } catch (error) {
        uploaded.set(id, { error: errorText(error) });
      }
    }
    return uploaded;
  }

  /** Replaces every uploaded link; one failed image fails only the drafts that use it. */
  function renderBody(body: string, uploaded: Map<string, UploadedAsset>): { body: string; error: string | null } {
    let error: string | null = null;
    const rendered = body.replace(ASSET_LINK, (match: string, _alt: string, id: string) => {
      const asset = uploaded.get(id);
      if (asset === undefined || 'error' in asset) {
        error ??= asset?.error ?? `Image ${id} was not uploaded`;
        return match;
      }
      return asset.markdown;
    });
    return { body: rendered, error };
  }

  function positionFor(
    draft: Extract<DraftOperation, { op: 'comment' }>,
    refs: DiffRefs,
  ): Record<string, unknown> {
    const base = {
      position_type: 'text',
      base_sha: refs.baseSha,
      start_sha: refs.startSha,
      head_sha: refs.headSha,
      old_path: draft.path,
      new_path: draft.path,
    };
    const end = linePair(draft.oldLine, draft.newLine, { side: draft.side, line: draft.line });

    // GitLab accepts line_range for multi-line notes; a range outside a hunk would be invalid, but
    // the outbox only produces ranges from visible diff rows.
    if (draft.startLine !== null && draft.startLine < draft.line) {
      const start = linePair(draft.startOldLine, draft.startNewLine, {
        side: draft.side,
        line: draft.startLine,
      });
      return {
        ...base,
        ...end,
        line_range: {
          start: { ...lineType(start), ...start },
          end: { ...lineType(end), ...end },
        },
      };
    }
    return { ...base, ...end };
  }

  function findDiscussion(threads: Thread[], commentId: string): string {
    const thread = threads.find((candidate) => candidate.comments.some((comment) => comment.id === commentId));
    if (thread === undefined) {
      throw new ForgeError(404, `Comment ${commentId} is not in the merge request discussions`);
    }
    return thread.id;
  }

  const forge: Forge = {
    kind: 'gitlab',
    capabilities: {
      imageUpload: true,
      // Sent as `reviewer_state: 'requested_changes'` in bulk_publish; it does not approve.
      requestChanges: true,
      threadedPrComments: true,
      resolveThreads: true,
    },
    currentUser,
    pullRequestRef: (number) => `merge-requests/${number}/head`,
    webUrl: (repo, sha, path, line) => fileWebUrl(host.webUrl, repo.project, sha, path, line, '/-/blob/'),
    cloneUrl: (repo) => `${host.webUrl}/${repo.project}.git`,

    async listPullRequests(repo: RepoRef, listOptions: ListPullRequestsOptions): Promise<PullRequestSummary[]> {
      const query = new URLSearchParams();
      query.set('state', listOptions.state === 'open' ? 'opened' : 'all');
      query.set('per_page', '100');
      if (listOptions.author !== undefined) {
        query.set('author_username', listOptions.author);
      }
      const mrs = await http.getAll(`${mergeRequests(repo)}?${query.toString()}`, MergeRequestSchema);
      return mrs.map(toSummary);
    },

    async getPullRequest(repo: RepoRef, number: number): Promise<PullRequest> {
      const mr = await readMergeRequest(repo, number);
      const refs = mr.diff_refs;
      if (refs === null || refs === undefined) {
        throw new ForgeError(502, 'Merge request has no diff refs');
      }
      rememberRefs(repo, number, mr);
      return {
        ...toSummary(mr),
        body: mr.description ?? '',
        baseSha: refs.base_sha,
        headSha: refs.head_sha,
        mergeBaseSha: refs.base_sha,
      };
    },

    async listThreads(repo: RepoRef, number: number): Promise<Thread[]> {
      // The current head is needed to mark outdated positions; one MR read also fills the start_sha cache.
      const [discussions, mr, me] = await Promise.all([
        http.getAll(`${requestPath(repo, number)}/discussions?per_page=100`, DiscussionSchema),
        readMergeRequest(repo, number),
        currentUser(),
      ]);
      rememberRefs(repo, number, mr);
      const headSha = mr.diff_refs?.head_sha ?? mr.sha;
      return discussions.flatMap((discussion) => {
        // System notes ("added 3 commits") are events, not review comments.
        const notes = discussion.notes.filter((note) => note.system !== true);
        const root = notes[0];
        return root === undefined ? [] : [toThread(discussion.id, root, notes, headSha, me)];
      });
    },

    async submit(
      repo: RepoRef,
      number: number,
      pr: PullRequest,
      drafts: DraftOperation[],
      action: ReviewAction | null,
      summary: string | null,
    ): Promise<SubmitResult[]> {
      const results: SubmitResult[] = drafts.map((draft) => ({ draftId: draft.draftId, ok: false }));
      const failRemaining = (from: number, error: string): void => {
        for (let index = from; index < drafts.length; index += 1) {
          const draft = drafts[index];
          if (draft !== undefined) {
            results[index] = { draftId: draft.draftId, ok: false, error };
          }
        }
      };

      const uploaded = await uploadAssets(repo, drafts);

      let refs: DiffRefs | null = null;
      if (drafts.some((draft) => draft.op === 'comment')) {
        try {
          refs = await ensureRefs(repo, number);
        } catch (error) {
          const message = errorText(error);
          drafts.forEach((draft, index) => {
            results[index] = { draftId: draft.draftId, ok: false, error: message };
          });
          return results;
        }
      }

      const createdDrafts: Array<{ index: number; id: number }> = [];
      let threads: Thread[] | null = null;
      let stopped = false;

      for (let index = 0; index < drafts.length && !stopped; index += 1) {
        const draft = drafts[index];
        if (draft === undefined) {
          continue;
        }

        let body: string | null = null;
        if ('body' in draft) {
          const rendered = renderBody(draft.body, uploaded);
          if (rendered.error !== null) {
            results[index] = { draftId: draft.draftId, ok: false, error: rendered.error };
            continue;
          }
          body = rendered.body;
        }

        try {
          switch (draft.op) {
            case 'comment': {
              // A comment path only exists when `refs` was loaded above.
              const position = positionFor(draft, refs ?? { baseSha: pr.baseSha, headSha: pr.headSha, startSha: pr.baseSha });
              const note = await http.send(
                'POST',
                `${requestPath(repo, number)}/draft_notes`,
                { note: body, position },
                DraftNoteSchema,
              );
              createdDrafts.push({ index, id: note.id });
              results[index] = { draftId: draft.draftId, ok: true, remoteId: String(note.id) };
              break;
            }
            case 'reply': {
              const note = await http.send(
                'POST',
                `${requestPath(repo, number)}/draft_notes`,
                { note: body, in_reply_to_discussion_id: draft.threadId },
                DraftNoteSchema,
              );
              createdDrafts.push({ index, id: note.id });
              results[index] = { draftId: draft.draftId, ok: true, remoteId: String(note.id) };
              break;
            }
            case 'prComment': {
              const note = await http.send(
                'POST',
                `${requestPath(repo, number)}/draft_notes`,
                { note: body },
                DraftNoteSchema,
              );
              createdDrafts.push({ index, id: note.id });
              results[index] = { draftId: draft.draftId, ok: true, remoteId: String(note.id) };
              break;
            }
            case 'edit': {
              threads ??= await forge.listThreads(repo, number);
              const discussion = findDiscussion(threads, draft.commentId);
              await http.send(
                'PUT',
                `${requestPath(repo, number)}/discussions/${encodeURIComponent(discussion)}/notes/${draft.commentId}`,
                { body },
                z.unknown(),
              );
              results[index] = { draftId: draft.draftId, ok: true, remoteId: draft.commentId };
              break;
            }
            case 'delete': {
              threads ??= await forge.listThreads(repo, number);
              const discussion = findDiscussion(threads, draft.commentId);
              await http.send(
                'DELETE',
                `${requestPath(repo, number)}/discussions/${encodeURIComponent(discussion)}/notes/${draft.commentId}`,
                undefined,
                z.undefined(),
              );
              results[index] = { draftId: draft.draftId, ok: true, remoteId: draft.commentId };
              break;
            }
          }
        } catch (error) {
          results[index] = { draftId: draft.draftId, ok: false, error: errorText(error) };
          if (isAuthError(error)) {
            // A missing/expired token will fail every later call the same way; stop and report the
            // same reason on the drafts that were not attempted.
            failRemaining(index + 1, errorText(error));
            stopped = true;
          }
        }
      }

      // Draft notes must be published together so the author receives one notification.
      const wantsRequestChanges = action === 'requestChanges';
      const shouldPublish = createdDrafts.length > 0 || summary !== null || wantsRequestChanges;
      let publishFailed: string | null = null;

      if (shouldPublish) {
        const publishBody: Record<string, unknown> = {};
        if (summary !== null) {
          publishBody.note = summary;
        }
        if (wantsRequestChanges) {
          publishBody.reviewer_state = 'requested_changes';
        }
        try {
          await http.send(
            'POST',
            `${requestPath(repo, number)}/draft_notes/bulk_publish`,
            publishBody,
            z.unknown(),
          );
        } catch (error) {
          publishFailed = errorText(error);
          for (const created of createdDrafts) {
            const draft = drafts[created.index];
            if (draft !== undefined) {
              results[created.index] = { draftId: draft.draftId, ok: false, error: publishFailed };
            }
            // Best effort: a retry must not publish these drafts twice.
            try {
              await http.send(
                'DELETE',
                `${requestPath(repo, number)}/draft_notes/${created.id}`,
                undefined,
                z.undefined(),
              );
            } catch {
              // The publish already failed; a leftover draft is less harmful than masking that error.
            }
          }
        }
      }

      if (publishFailed === null && action === 'approve') {
        try {
          await http.send(
            'POST',
            `${requestPath(repo, number)}/approve`,
            { sha: pr.headSha },
            z.unknown(),
          );
        } catch (error) {
          // There is no draft to attach the verdict to; the synthetic result lets the UI report it.
          results.push({ draftId: 'approve', ok: false, error: errorText(error) });
        }
      }

      return results;
    },
  };

  return forge;
}

// ── Mapping helpers ─────────────────────────────────────────────────────────

function toSummary(mr: MergeRequest): PullRequestSummary {
  return {
    number: mr.iid,
    title: mr.title,
    author: mr.author.username,
    state: mr.state === 'opened' ? 'open' : mr.state === 'merged' ? 'merged' : 'closed',
    draft: mr.draft ?? false,
    updatedAt: mr.updated_at,
    baseRef: mr.target_branch,
    headRef: mr.source_branch,
    headSha: mr.sha,
    webUrl: mr.web_url,
    commentCount: mr.user_notes_count ?? null,
  };
}

function toThread(id: string, root: Note, notes: Note[], headSha: string, me: string): Thread {
  const position = root.position ?? null;
  // A PR-level discussion has no position; the new side is the neutral default for the shared model.
  const side: CommentSide = position === null || isLine(position.new_line) ? 'new' : 'old';
  const line = position === null ? null : (side === 'new' ? (position.new_line ?? null) : (position.old_line ?? null));
  const start = position?.line_range?.start;
  const startLine = start === undefined ? null : (side === 'new' ? (start.new_line ?? null) : (start.old_line ?? null));

  return {
    id,
    path: position === null ? null : (position.new_path ?? position.old_path ?? null),
    side,
    line,
    startLine,
    outdated: position !== null && position.head_sha !== undefined && position.head_sha !== headSha,
    resolved: root.resolved === true,
    comments: notes.map((note) => ({
      id: String(note.id),
      author: note.author?.username ?? '',
      body: note.body ?? '',
      createdAt: note.created_at,
      updatedAt: note.updated_at,
      canEdit: note.author?.username === me,
    })),
  };
}

/**
 * The explicit pair from the diff row wins: both set = unchanged line, only one set = added or
 * removed. Without either, `side` says which line number the draft carries.
 */
function linePair(
  oldLine: number | null | undefined,
  newLine: number | null | undefined,
  fallback: { side: CommentSide; line: number },
): LinePair {
  if (isLine(oldLine) && isLine(newLine)) {
    return { old_line: oldLine, new_line: newLine };
  }
  if (isLine(newLine)) {
    return { new_line: newLine };
  }
  if (isLine(oldLine)) {
    return { old_line: oldLine };
  }
  return fallback.side === 'old' ? { old_line: fallback.line } : { new_line: fallback.line };
}

/** Range points carry a `type` only when they name one side; unchanged points name both. */
function lineType(pair: LinePair): { type?: 'new' | 'old' } {
  const hasOld = pair.old_line !== undefined;
  const hasNew = pair.new_line !== undefined;
  if (hasNew && !hasOld) {
    return { type: 'new' };
  }
  if (hasOld && !hasNew) {
    return { type: 'old' };
  }
  return {};
}

function isLine(value: number | null | undefined): value is number {
  return value !== null && value !== undefined;
}

function isAuthError(error: unknown): boolean {
  return error instanceof ForgeError && (error.status === 401 || error.status === 403);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

/** Reads the forge message without letting an echoed auth header reach the UI. */
async function safeResponseMessage(response: Response, headers: Headers): Promise<string> {
  const text = await response.text().catch(() => '');
  let message = response.statusText;
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === 'object' && parsed !== null && 'message' in parsed) {
      const value = (parsed as { message?: unknown }).message;
      if (typeof value === 'string' && value !== '') {
        message = value;
      }
    }
  } catch {
    // Not JSON; the status text is enough.
  }
  for (const [, value] of headers) {
    if (value !== '') {
      message = message.split(value).join('[redacted]');
    }
  }
  return message.trim() === '' ? `HTTP ${response.status}` : message;
}
