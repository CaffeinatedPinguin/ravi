/**
 * The forge strategy. One object per host implementation; callers depend on this interface, never on
 * a forge kind. The single exception is the registry, which maps a kind to its factory.
 */
import { HttpError } from '../http/router.ts';
import type {
  DraftOperation,
  ForgeCapabilities,
  ForgeKind,
  PullRequest,
  PullRequestSummary,
  RepoRef,
  ReviewAction,
  SubmitResult,
  Thread,
} from '../../shared/forge.ts';
import type { ForgeHttp } from './http.ts';

export type ListPullRequestsOptions = {
  /** Only open pull requests, or every pull request the token can see. */
  state: 'open' | 'all';
  /** Limit to pull requests authored by this login. */
  author?: string;
};

/** Registry entry: where a host lives, how to authenticate and which strategy handles it. */
export type ForgeHost = {
  /** Host name as it appears in a `RepoRef`, e.g. `github.com`. */
  host: string;
  /** Strategy kind; also the key in `FACTORIES`. */
  kind: ForgeKind;
  /** Base URL of the host's API. */
  apiUrl: string;
  /** Base URL of the host's web UI. */
  webUrl: string;
  /** Name of the variable in `~/.ravi/.env` that holds the token. */
  tokenEnv: string;
  /** Adds the forge-specific authentication headers; the token is passed in, never stored here. */
  auth: (token: string, headers: Headers) => void;
};

/** Builds a strategy for one host; the registry owns the mapping from kind to this function. */
export type ForgeFactory = (host: ForgeHost, http: ForgeHttp) => Forge;

export interface Forge {
  /** Strategy kind; exposed for diagnostics and status, not for feature branching. */
  readonly kind: ForgeKind;
  /** What this forge can do; the UI and review logic ask here, never for the kind. */
  readonly capabilities: ForgeCapabilities;

  /** Login of the user the token belongs to. */
  currentUser(): Promise<string>;

  /** Git ref that can be fetched to review a pull request, e.g. `pull/42/head`. */
  pullRequestRef(number: number): string;

  /** Browser URL of a file at a commit, optionally anchored to a line. */
  webUrl(repo: RepoRef, sha: string, path: string, line?: number): string;

  /** HTTPS URL used to clone the repository. */
  cloneUrl(repo: RepoRef): string;

  /** Pull requests visible to the token, newest first. */
  listPullRequests(repo: RepoRef, options: ListPullRequestsOptions): Promise<PullRequestSummary[]>;

  /** One pull request with the commit ids needed to build the diff. */
  getPullRequest(repo: RepoRef, number: number): Promise<PullRequest>;

  /** Every review thread, including resolved and outdated ones. */
  listThreads(repo: RepoRef, number: number): Promise<Thread[]>;

  /**
   * Sends the selected drafts. A single failed operation is reported in its `SubmitResult` and must
   * not abort the others, so the caller can retry only what failed. Only this method writes to the
   * forge.
   */
  submit(
    repo: RepoRef,
    number: number,
    pr: PullRequest,
    drafts: DraftOperation[],
    action: ReviewAction | null,
    summary: string | null,
  ): Promise<SubmitResult[]>;
}

/**
 * Pseudo draft id a strategy uses for the review-level verdict. `submit` normally returns one
 * result per `DraftOperation`; when an action (approve / request changes / comment with a summary)
 * was sent it also appends one result with this id, so the caller can report the verdict separately
 * from the comment results without changing the return type.
 */
export const REVIEW_RESULT_ID = '__review__';

/** Rejected promise used by skeleton strategies for methods a later task will implement. */
export function notImplemented(): Promise<never> {
  return Promise.reject(new HttpError(501, 'Not implemented yet'));
}
