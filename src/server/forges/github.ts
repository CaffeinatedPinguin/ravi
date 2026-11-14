/**
 * GitHub.com strategy.
 *
 * The shape of the GitHub REST answers is validated at the edge (Zod) and mapped to the shared
 * forge model. GitHub-specific quirks are contained here: review threads have no REST resolution
 * state, a reply can only target a top-level review comment, and an inline comment that GitHub
 * considers outside the diff must be downgraded to a file-level comment.
 */
import { z } from 'zod';
import type {
  CommentSide,
  DraftOperation,
  PullRequest,
  PullRequestState,
  PullRequestSummary,
  RemoteComment,
  RepoRef,
  ReviewAction,
  SubmitResult,
  Thread,
} from '../../shared/forge.ts';
import type { Forge, ForgeHost } from './forge.ts';
import { ForgeError } from './http.ts';
import type { ForgeHttp } from './http.ts';
import { fileWebUrl } from './urls.ts';

const USER_SCHEMA = z.object({ login: z.string() });

const PULL_REQUEST_SCHEMA = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  user: USER_SCHEMA,
  state: z.enum(['open', 'closed']),
  draft: z.boolean(),
  updated_at: z.string(),
  base: z.object({ ref: z.string(), sha: z.string() }),
  head: z.object({ ref: z.string(), sha: z.string() }),
  html_url: z.string(),
  merged_at: z.string().nullable().default(null),
});

const PULL_REQUEST_DETAILS_SCHEMA = PULL_REQUEST_SCHEMA.extend({
  body: z.string().nullable().default(null),
  comments: z.number().int().nonnegative().default(0),
  review_comments: z.number().int().nonnegative().default(0),
});

const REVIEW_COMMENT_SCHEMA = z.object({
  id: z.number().int(),
  user: USER_SCHEMA,
  body: z.string().nullable().default(null),
  path: z.string(),
  line: z.number().int().nullable().default(null),
  start_line: z.number().int().nullable().default(null),
  side: z.enum(['LEFT', 'RIGHT']),
  original_line: z.number().int().nullable().default(null),
  in_reply_to_id: z.number().int().nullable().default(null),
  created_at: z.string(),
  updated_at: z.string(),
  subject_type: z.enum(['line', 'file']).optional(),
});

const ISSUE_COMMENT_SCHEMA = z.object({
  id: z.number().int(),
  user: USER_SCHEMA,
  body: z.string().nullable().default(null),
  created_at: z.string(),
  updated_at: z.string(),
});

/** A created review or comment; the review response does not carry the ids of its comments. */
const CREATED_SCHEMA = z.object({ id: z.number().int() });
const EMPTY_SCHEMA = z.unknown();

type PullRequestPayload = z.infer<typeof PULL_REQUEST_SCHEMA>;
type PullRequestDetails = z.infer<typeof PULL_REQUEST_DETAILS_SCHEMA>;
type ReviewComment = z.infer<typeof REVIEW_COMMENT_SCHEMA>;
type IssueComment = z.infer<typeof ISSUE_COMMENT_SCHEMA>;
type CommentPayload = {
  path: string;
  body: string;
  line: number;
  side: 'LEFT' | 'RIGHT';
  start_line?: number;
  start_side?: 'LEFT' | 'RIGHT';
};
type ReviewEvent = 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';

export function createGitHubForge(host: ForgeHost, http: ForgeHttp): Forge {
  let cachedUser: Promise<string> | undefined;

  const currentUser = async (): Promise<string> => {
    if (cachedUser === undefined) {
      cachedUser = http.get('/user', USER_SCHEMA).then((user) => user.login);
    }
    try {
      return await cachedUser;
    } catch (error) {
      // A failed lookup must not poison the instance; the next call can retry.
      cachedUser = undefined;
      throw error instanceof Error ? error : new Error('Cannot read the GitHub user');
    }
  };

  return {
    kind: 'github',
    capabilities: {
      imageUpload: false,
      requestChanges: true,
      threadedPrComments: false,
      resolveThreads: true,
    },
    currentUser,
    pullRequestRef: (number) => `pull/${number}/head`,
    webUrl: (repo, sha, path, line) => fileWebUrl(host.webUrl, repo.project, sha, path, line, '/blob/'),
    cloneUrl: (repo) => `${host.webUrl}/${repo.project}.git`,

    async listPullRequests(repo, options) {
      const pulls = await http.getAll(
        `${repoPath(repo)}/pulls?state=${options.state}&per_page=100`,
        PULL_REQUEST_SCHEMA,
      );
      const author = options.author?.toLowerCase();
      return pulls
        .filter((pull) => author === undefined || pull.user.login.toLowerCase() === author)
        .map(toSummary);
    },

    async getPullRequest(repo, number) {
      const pull = await http.get(`${pullsPath(repo, number)}`, PULL_REQUEST_DETAILS_SCHEMA);
      return toPullRequest(pull);
    },

    async listThreads(repo, number) {
      const [reviewComments, issueComments, login] = await Promise.all([
        http.getAll(`${pullsPath(repo, number)}/comments?per_page=100`, REVIEW_COMMENT_SCHEMA),
        http.getAll(`${repoPath(repo)}/issues/${number}/comments?per_page=100`, ISSUE_COMMENT_SCHEMA),
        currentUser(),
      ]);

      const byId = new Map(reviewComments.map((comment) => [String(comment.id), comment]));
      const groups = new Map<string, ReviewComment[]>();
      for (const comment of reviewComments) {
        const threadId = rootIdOf(comment, byId);
        const group = groups.get(threadId);
        if (group === undefined) {
          groups.set(threadId, [comment]);
        } else {
          group.push(comment);
        }
      }

      const threads = [...groups].map(([threadId, group]) =>
        threadFromReviewComments(threadId, group, byId, login),
      );
      // REST exposes no thread resolution state (GitHub only has it through GraphQL); leave false.
      for (const comment of issueComments) {
        // GitHub has no threads for pull request conversation comments: each one stands alone.
        threads.push({
          id: String(comment.id),
          path: null,
          side: 'new',
          line: null,
          startLine: null,
          outdated: false,
          resolved: false,
          comments: [toRemoteComment(comment, login)],
        });
      }
      return threads;
    },

    async submit(repo, number, pr, drafts, action, summary) {
      const results = new Map<string, SubmitResult>();
      const reviewUrl = `${pullsPath(repo, number)}/reviews`;
      const event = eventOf(action);
      let fatal: string | null = null;

      const record = (draftId: string, result: Omit<SubmitResult, 'draftId'>): void => {
        results.set(draftId, { draftId, ...result });
      };

      const fail = (draftId: string, error: unknown, phase: 'review' | 'comment'): string => {
        const message = errorMessage(error);
        if (isAuthenticationFailure(error, phase)) {
          fatal = message;
        }
        record(draftId, { ok: false, error: message });
        return message;
      };

      const commentDrafts = drafts.filter(
        (draft): draft is Extract<DraftOperation, { op: 'comment' }> => draft.op === 'comment',
      );
      const replyDrafts = drafts.filter(
        (draft): draft is Extract<DraftOperation, { op: 'reply' }> => draft.op === 'reply',
      );
      const prCommentDrafts = drafts.filter(
        (draft): draft is Extract<DraftOperation, { op: 'prComment' }> => draft.op === 'prComment',
      );
      const editDrafts = drafts.filter(
        (draft): draft is Extract<DraftOperation, { op: 'edit' }> => draft.op === 'edit',
      );
      const deleteDrafts = drafts.filter(
        (draft): draft is Extract<DraftOperation, { op: 'delete' }> => draft.op === 'delete',
      );

      const reviewPayload = (comments: CommentPayload[]) => ({
        commit_id: pr.headSha,
        event,
        ...(reviewBody(summary, event) === undefined ? {} : { body: reviewBody(summary, event) }),
        comments,
      });

      // 1. One review carries every new inline comment. GitHub creates a PENDING review when the
      //    event is omitted, so an event is always sent.
      if (commentDrafts.length > 0 || action !== null || (summary ?? '').trim() !== '') {
        try {
          const review = await http.send(
            'POST',
            reviewUrl,
            reviewPayload(commentDrafts.map(commentPayload)),
            CREATED_SCHEMA,
          );
          for (const draft of commentDrafts) {
            // The review response has no comment ids; the review id identifies the batch.
            record(draft.draftId, { ok: true, remoteId: String(review.id) });
          }
        } catch (error) {
          const message = errorMessage(error);
          if (isAuthenticationFailure(error, 'review')) {
            fatal = message;
            for (const draft of commentDrafts) {
              record(draft.draftId, { ok: false, error: message });
            }
          } else if (isReviewCommentRejection(error)) {
            // GitHub rejects the whole review when one line is outside the diff; retry each
            // comment on its own so only the offending ones are downgraded.
            for (const draft of commentDrafts) {
              if (fatal !== null) {
                break;
              }
              await retrySingleComment(draft);
            }
          } else {
            for (const draft of commentDrafts) {
              record(draft.draftId, { ok: false, error: message });
            }
          }
        }
      }

      async function retrySingleComment(draft: Extract<DraftOperation, { op: 'comment' }>): Promise<void> {
        try {
          const review = await http.send(
            'POST',
            reviewUrl,
            reviewPayload([commentPayload(draft)]),
            CREATED_SCHEMA,
          );
          record(draft.draftId, { ok: true, remoteId: String(review.id) });
          return;
        } catch (error) {
          if (isAuthenticationFailure(error, 'review')) {
            fail(draft.draftId, error, 'review');
            return;
          }
          if (!isReviewCommentRejection(error)) {
            record(draft.draftId, { ok: false, error: errorMessage(error) });
            return;
          }
        }

        // The line is not in the diff: a file-level comment accepts no line, so keep the line in
        // the text where the reader can still see it.
        try {
          const created = await http.send(
            'POST',
            `${pullsPath(repo, number)}/comments`,
            {
              commit_id: pr.headSha,
              path: draft.path,
              body: `Line ${draft.line}: ${draft.body}`,
              subject_type: 'file',
            },
            CREATED_SCHEMA,
          );
          record(draft.draftId, { ok: true, remoteId: String(created.id) });
        } catch (error) {
          fail(draft.draftId, error, 'comment');
        }
      }

      // 2. Replies. GitHub only accepts a reply to a top-level comment, so resolve the chain.
      if (replyDrafts.length > 0 && fatal === null) {
        let roots = new Map<string, string>();
        try {
          const comments = await http.getAll(
            `${pullsPath(repo, number)}/comments?per_page=100`,
            REVIEW_COMMENT_SCHEMA,
          );
          roots = replyRoots(comments);
        } catch (error) {
          // Without the list the given id is the best guess; an auth failure still stops the rest.
          if (isAuthenticationFailure(error, 'comment')) {
            fatal = errorMessage(error);
          }
        }
        for (const draft of replyDrafts) {
          if (fatal !== null) {
            break;
          }
          const target = roots.get(draft.threadId) ?? draft.threadId;
          if (!isNumericId(target)) {
            record(draft.draftId, { ok: false, error: 'Invalid GitHub comment id' });
            continue;
          }
          try {
            const created = await http.send(
              'POST',
              `${pullsPath(repo, number)}/comments/${target}/replies`,
              { body: draft.body },
              CREATED_SCHEMA,
            );
            record(draft.draftId, { ok: true, remoteId: String(created.id) });
          } catch (error) {
            fail(draft.draftId, error, 'comment');
          }
        }
      }

      // 3. Conversation comments on the pull request.
      if (prCommentDrafts.length > 0 && fatal === null) {
        for (const draft of prCommentDrafts) {
          if (fatal !== null) {
            break;
          }
          try {
            const created = await http.send(
              'POST',
              `${repoPath(repo)}/issues/${number}/comments`,
              { body: draft.body },
              CREATED_SCHEMA,
            );
            record(draft.draftId, { ok: true, remoteId: String(created.id) });
          } catch (error) {
            fail(draft.draftId, error, 'comment');
          }
        }
      }

      // 4. Edits and deletes. Both objects look the same over REST, so a 404 on the review-comment
      //    endpoint means the id belongs to a conversation comment.
      if (editDrafts.length > 0 && fatal === null) {
        for (const draft of editDrafts) {
          if (fatal !== null) {
            break;
          }
          if (!isNumericId(draft.commentId)) {
            record(draft.draftId, { ok: false, error: 'Invalid GitHub comment id' });
            continue;
          }
          const remoteId = await mutateComment(draft.commentId, 'PATCH', { body: draft.body }, draft.draftId);
          if (remoteId !== null) {
            record(draft.draftId, { ok: true, remoteId });
          }
        }
      }

      if (deleteDrafts.length > 0 && fatal === null) {
        for (const draft of deleteDrafts) {
          if (fatal !== null) {
            break;
          }
          if (!isNumericId(draft.commentId)) {
            record(draft.draftId, { ok: false, error: 'Invalid GitHub comment id' });
            continue;
          }
          const deleted = await mutateComment(draft.commentId, 'DELETE', undefined, draft.draftId);
          if (deleted !== null) {
            record(draft.draftId, { ok: true, remoteId: deleted });
          }
        }
      }

      async function mutateComment(
        commentId: string,
        method: 'PATCH' | 'DELETE',
        body: { body: string } | undefined,
        draftId: string,
      ): Promise<string | null> {
        const paths = [
          `${repoPath(repo)}/pulls/comments/${commentId}`,
          `${repoPath(repo)}/issues/comments/${commentId}`,
        ];
        for (const [index, path] of paths.entries()) {
          try {
            if (method === 'PATCH') {
              const updated = await http.send('PATCH', path, body, CREATED_SCHEMA);
              return String(updated.id);
            }
            await http.send('DELETE', path, body, EMPTY_SCHEMA);
            return commentId;
          } catch (error) {
            const missing = error instanceof ForgeError && error.status === 404;
            if (!missing || index === paths.length - 1) {
              fail(draftId, error, 'comment');
              return null;
            }
          }
        }
        return null;
      }

      // A rejected token means every remaining request would fail too; report it without sending.
      if (fatal !== null) {
        for (const draft of drafts) {
          if (!results.has(draft.draftId)) {
            record(draft.draftId, { ok: false, error: fatal });
          }
        }
      }

      return drafts.map(
        (draft) => results.get(draft.draftId) ?? { draftId: draft.draftId, ok: false, error: 'Not sent' },
      );
    },
  };
}

// ── Mapping GitHub payloads to the shared model ─────────────────────────────

function toSummary(pull: PullRequestPayload): PullRequestSummary {
  return {
    number: pull.number,
    title: pull.title,
    author: pull.user.login,
    state: stateOf(pull),
    draft: pull.draft,
    updatedAt: pull.updated_at,
    baseRef: pull.base.ref,
    headRef: pull.head.ref,
    headSha: pull.head.sha,
    webUrl: pull.html_url,
    commentCount: null,
  };
}

function toPullRequest(pull: PullRequestDetails): PullRequest {
  return {
    ...toSummary(pull),
    body: pull.body ?? '',
    baseSha: pull.base.sha,
    headSha: pull.head.sha,
    // git computes the merge base locally; the forge gives only the branch tips.
    mergeBaseSha: null,
    commentCount: pull.comments + pull.review_comments,
  };
}

function stateOf(pull: PullRequestPayload): PullRequestState {
  return pull.merged_at !== null ? 'merged' : pull.state;
}

function toRemoteComment(comment: ReviewComment | IssueComment, login: string): RemoteComment {
  return {
    id: String(comment.id),
    author: comment.user.login,
    body: comment.body ?? '',
    createdAt: comment.created_at,
    updatedAt: comment.updated_at,
    canEdit: comment.user.login.toLowerCase() === login.toLowerCase(),
  };
}

/**
 * Finds the thread id of a review comment. Replies may point at another reply, so walk the chain;
 * a missing parent is still a usable thread id, which is what GitHub showed us.
 */
function rootIdOf(comment: ReviewComment, byId: Map<string, ReviewComment>): string {
  let current = comment;
  const seen = new Set<string>();
  while (current.in_reply_to_id !== null) {
    const parent = byId.get(String(current.in_reply_to_id));
    if (parent === undefined || seen.has(String(parent.id))) {
      return String(current.in_reply_to_id);
    }
    seen.add(String(current.id));
    current = parent;
  }
  return String(current.id);
}

/** Maps every review comment id to the id of its thread root, for reply submission. */
function replyRoots(comments: ReviewComment[]): Map<string, string> {
  const byId = new Map(comments.map((comment) => [String(comment.id), comment]));
  return new Map(comments.map((comment) => [String(comment.id), rootIdOf(comment, byId)]));
}

function threadFromReviewComments(
  threadId: string,
  group: ReviewComment[],
  byId: Map<string, ReviewComment>,
  login: string,
): Thread {
  const root = byId.get(threadId) ?? firstOf(group);
  if (root === undefined) {
    throw new Error('A review thread without comments');
  }
  const replies = group
    .filter((comment) => comment.id !== root.id)
    .sort((left, right) => left.created_at.localeCompare(right.created_at) || left.id - right.id);
  const isFile = root.subject_type === 'file';
  return {
    id: threadId,
    path: root.path,
    side: sideOf(root.side),
    // An outdated comment loses `line`; `original_line` keeps the position on the base diff.
    line: isFile ? null : (root.line ?? root.original_line),
    startLine: isFile ? null : root.start_line,
    outdated: !isFile && root.line === null,
    resolved: false,
    comments: [root, ...replies].map((comment) => toRemoteComment(comment, login)),
  };
}

function firstOf(comments: ReviewComment[]): ReviewComment | undefined {
  return comments[0];
}

function sideOf(side: 'LEFT' | 'RIGHT'): CommentSide {
  return side === 'RIGHT' ? 'new' : 'old';
}

// ── Submit helpers ─────────────────────────────────────────────────────────

function commentPayload(draft: Extract<DraftOperation, { op: 'comment' }>): CommentPayload {
  const side = draft.side === 'new' ? 'RIGHT' : 'LEFT';
  const payload: CommentPayload = {
    path: draft.path,
    body: draft.body,
    line: draft.line,
    side,
  };
  if (draft.startLine !== null && draft.startLine !== draft.line) {
    payload.start_line = draft.startLine;
    payload.start_side = side;
  }
  return payload;
}

function eventOf(action: ReviewAction | null): ReviewEvent {
  if (action === 'approve') {
    return 'APPROVE';
  }
  if (action === 'requestChanges') {
    return 'REQUEST_CHANGES';
  }
  return 'COMMENT';
}

/**
 * GitHub requires a non-empty body for COMMENT and REQUEST_CHANGES reviews; a single space passes
 * that validation. APPROVE may omit the body, which is preferable for a comments-only approval.
 */
function reviewBody(summary: string | null, event: ReviewEvent): string | undefined {
  const text = summary ?? '';
  if (text.trim() !== '') {
    return text;
  }
  return event === 'APPROVE' ? undefined : ' ';
}

function repoPath(repo: RepoRef): string {
  return `/repos/${repo.project}`;
}

function pullsPath(repo: RepoRef, number: number): string {
  return `${repoPath(repo)}/pulls/${number}`;
}

function isNumericId(value: string): boolean {
  return /^\d+$/.test(value);
}

function isReviewCommentRejection(error: unknown): boolean {
  if (!(error instanceof ForgeError) || error.status !== 422) {
    return false;
  }
  // The REST client keeps only the top-level message. GitHub usually answers a rejected review
  // comment with the generic "Validation Failed" and puts the line details in `errors[]`, which
  // the client does not expose; the per-comment retry is what isolates the offending line.
  return (
    /validation failed/i.test(error.message) ||
    /not (?:a )?part of the diff|line.*diff/i.test(error.message)
  );
}

/**
 * A rejected token always stops the rest. A missing permission on the review itself means the
 * token may not review this pull request at all, so remaining drafts are not attempted; a 403 on
 * one edit or reply only concerns that comment and the others are still worth sending.
 */
function isAuthenticationFailure(error: unknown, phase: 'review' | 'comment'): boolean {
  if (!(error instanceof ForgeError)) {
    return false;
  }
  return error.status === 401 || (phase === 'review' && error.status === 403);
}

function errorMessage(error: unknown): string {
  return error instanceof ForgeError ? error.message : 'Unexpected failure while sending to GitHub';
}
