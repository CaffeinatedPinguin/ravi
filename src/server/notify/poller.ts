/**
 * Background poller for comments on the user's own open pull requests.
 *
 * The first time a pull request is seen its comments become the baseline: they are recorded as
 * seen (and kept for the preview) but notify nobody, so starting ravi never bursts the inbox.
 * Later polls notify only comments whose forge id was not seen before.
 *
 * Everything that touches the outside world is injectable (`forgeFor`, `now`, `timer`) so tests
 * never open a socket or wait on a real clock.
 */
import type { Repo } from '../../shared/api.ts';
import type { PullRequestSummary, RepoRef, Thread } from '../../shared/forge.ts';
import { MAX_SEEN_IDS } from '../../shared/notify.ts';
import type { Notification, NotificationFilters } from '../../shared/notify.ts';
import type { Forge } from '../forges/forge.ts';
import { ForgeError } from '../forges/http.ts';
import { forgeFor } from '../forges/registry.ts';
import { HttpError } from '../http/router.ts';
import type { Paths } from '../paths.ts';
import { listRepos } from '../store/repos.ts';
import { readSettings } from '../store/settings.ts';
import { shouldNotify } from './filter.ts';
import { addNotification, addRecent, readNotificationStore, writeNotificationStore } from './store.ts';
import type { NotificationStore } from './store.ts';

/** Test seam: the default reads the token and builds a real strategy. */
export type NotifyForgeLookup = (repo: Repo) => Promise<Forge>;

/** Minimal timer interface; a fake lets a test decide when the next cycle happens. */
export type NotifyTimer = {
  set(callback: () => void, delayMs: number): unknown;
  clear(handle: unknown): void;
};

export type NotifyDeps = {
  forgeFor?: NotifyForgeLookup;
  now?: () => Date;
  timer?: NotifyTimer;
  /** Hosts still waiting out a retry-after, as epoch milliseconds; the start loop owns this map. */
  notBefore?: ReadonlyMap<string, number>;
};

/** Which hosts asked the caller to wait, and until when (epoch milliseconds). */
export type PollResult = {
  postponed: Record<string, number>;
};

const defaultTimer: NotifyTimer = {
  set: (callback, delayMs) => setTimeout(callback, delayMs),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

function defaultForgeLookup(paths: Paths): NotifyForgeLookup {
  return async (repo) => {
    if (repo.remote === null) {
      throw new HttpError(400, 'Repository has no forge remote');
    }
    return forgeFor(paths, repo.remote, { repoId: repo.id, tokenScope: repo.tokenScope });
  };
}

export function prKey(remote: RepoRef, number: number): string {
  return `${remote.host}|${remote.project}|${number}`;
}

/**
 * Retry-after deadlines survive between `pollOnce` calls (a manual "run now" right after a 429 must
 * not hammer the forge). `startPoller` can pass its own map; both are kept in sync with the answer.
 */
const hostDeadlines = new Map<string, Map<string, number>>();

function deadlinesFor(paths: Paths): Map<string, number> {
  let deadlines = hostDeadlines.get(paths.home);
  if (deadlines === undefined) {
    deadlines = new Map<string, number>();
    hostDeadlines.set(paths.home, deadlines);
  }
  return deadlines;
}

/**
 * One polling pass over every distinct remote on a host with a token. Errors stay local to one
 * pull request so a single broken thread cannot stop the rest; rate limits are reported back so
 * `startPoller` can skip that host until the forge allows it again.
 */
export async function pollOnce(paths: Paths, deps: NotifyDeps = {}): Promise<PollResult> {
  const now = deps.now ?? ((): Date => new Date());
  const lookup = deps.forgeFor ?? defaultForgeLookup(paths);
  const deadlines = deadlinesFor(paths);
  const notBefore = deps.notBefore ?? deadlines;
  const postponed: Record<string, number> = {};

  // Expired deadlines are forgotten so the map cannot retain every host that ever hit a limit.
  const startedAt = now().getTime();
  for (const [host, resumeAt] of deadlines) {
    if (resumeAt <= startedAt) {
      deadlines.delete(host);
    }
  }

  const postpone = (host: string, error: unknown): void => {
    if (
      error instanceof ForgeError &&
      (error.status === 429 || error.status === 403) &&
      error.retryAfterSeconds !== undefined
    ) {
      postponed[host] = now().getTime() + error.retryAfterSeconds * 1000;
    }
  };

  const filters: NotificationFilters = (await readSettings(paths)).notifications;
  const store = await readNotificationStore(paths);

  // Two connected repositories may point at the same forge project (e.g. a clone and a local
  // checkout). Poll the remote once; listRepos is newest-first, so the freshest repo id wins.
  const remotes = new Map<string, Repo>();
  for (const repo of await listRepos(paths)) {
    const remote = repo.remote;
    if (remote === null) {
      continue;
    }
    const key = `${remote.host}|${remote.project}`;
    if (!remotes.has(key)) {
      remotes.set(key, repo);
    }
  }

  const forges = new Map<string, Promise<Forge | null>>();
  const forgeForHost = (repo: Repo): Promise<Forge | null> => {
    const host = repo.remote?.host ?? '';
    let pending = forges.get(host);
    if (pending === undefined) {
      // A missing token is a normal state, not a failure: that host simply has nothing to poll.
      pending = lookup(repo).catch((error: unknown) => {
        if (error instanceof HttpError && (error.status === 400 || error.status === 401)) {
          return null;
        }
        throw error;
      });
      forges.set(host, pending);
    }
    return pending;
  };

  for (const repo of remotes.values()) {
    const remote = repo.remote;
    if (remote === null) {
      continue;
    }
    const resumeAt = notBefore.get(remote.host);
    if (resumeAt !== undefined && resumeAt > now().getTime()) {
      continue;
    }

    const forge = await forgeForHost(repo);
    if (forge === null) {
      continue;
    }

    let me: string;
    try {
      me = await forge.currentUser();
    } catch (error) {
      postpone(remote.host, error);
      continue;
    }

    let pullRequests: PullRequestSummary[];
    try {
      pullRequests = await forge.listPullRequests(remote, { state: 'open', author: me });
    } catch (error) {
      postpone(remote.host, error);
      continue;
    }

    for (const pullRequest of pullRequests) {
      try {
        const threads = await forge.listThreads(remote, pullRequest.number);
        ingest({ store, filters, me, repoId: repo.id, remote, pullRequest, threads, now });
      } catch (error) {
        postpone(remote.host, error);
      }
    }
  }

  for (const [host, resumeAt] of Object.entries(postponed)) {
    deadlines.set(host, resumeAt);
  }
  await writeNotificationStore(paths, store);
  return { postponed };
}

type IngestOptions = {
  store: NotificationStore;
  filters: NotificationFilters;
  me: string;
  repoId: string;
  remote: RepoRef;
  pullRequest: PullRequestSummary;
  threads: Thread[];
  now: () => Date;
};

function ingest({ store, filters, me, repoId, remote, pullRequest, threads, now }: IngestOptions): void {
  const key = prKey(remote, pullRequest.number);
  const marker = store.markers[key];
  const baseline = marker === undefined;
  const seen = new Set(marker?.seenIds ?? []);

  const comments = threads
    .flatMap((thread) => thread.comments.map((comment) => ({ thread, comment })))
    .sort((left, right) => left.comment.createdAt.localeCompare(right.comment.createdAt));
  const fresh = comments.filter(({ comment }) => !seen.has(comment.id));

  for (const { comment } of comments) {
    seen.add(comment.id);
  }

  // Baseline comments are shown in the preview but never notified; that is what makes the first
  // poll quiet. Afterwards only comments new since the previous pass enter `recent`.
  for (const { comment } of baseline ? comments : fresh) {
    addRecent(store, {
      id: `${key}|${comment.id}`,
      repoId,
      host: remote.host,
      project: remote.project,
      number: pullRequest.number,
      author: comment.author,
      body: comment.body,
      createdAt: comment.createdAt,
      viewer: me,
    });
  }

  if (!baseline) {
    for (const { thread, comment } of fresh) {
      if (!shouldNotify({ author: comment.author, body: comment.body }, filters, me)) {
        continue;
      }
      const notification: Notification = {
        id: `${key}|${comment.id}`,
        repoId,
        host: remote.host,
        project: remote.project,
        number: pullRequest.number,
        prTitle: pullRequest.title,
        threadId: thread.id,
        commentId: comment.id,
        author: comment.author,
        excerpt: excerpt(comment.body),
        createdAt: comment.createdAt,
        read: false,
      };
      addNotification(store, notification);
    }
  }

  store.markers[key] = {
    lastCheckedAt: now().toISOString(),
    // A very long-lived pull request cannot grow the file forever; the newest ids stay.
    seenIds: [...seen].slice(-MAX_SEEN_IDS),
  };
}

/** One readable line: collapse whitespace (markdown bodies are multi-line) and cap the excerpt. */
function excerpt(body: string): string {
  return body.replace(/\s+/g, ' ').trim().slice(0, 200);
}

/**
 * Re-reads settings every cycle (both the interval and the enabled flag), never overlaps two
 * passes, and schedules the next one only after the previous finished. `stop()` cancels the
 * pending timer; a run already in flight simply finishes without scheduling another.
 */
export function startPoller(paths: Paths, deps: NotifyDeps = {}): { stop: () => void } {
  const timer = deps.timer ?? defaultTimer;
  const now = deps.now ?? ((): Date => new Date());
  const postponed = new Map<string, number>();
  let stopped = false;
  let running = false;
  let handle: unknown;

  const schedule = (delayMs: number): void => {
    if (stopped) {
      return;
    }
    handle = timer.set(() => {
      void tick();
    }, delayMs);
  };

  const tick = async (): Promise<void> => {
    if (stopped || running) {
      return;
    }
    running = true;
    let delay = 5 * 60_000;
    try {
      const settings = (await readSettings(paths)).notifications;
      delay = settings.pollMinutes * 60_000;
      if (settings.enabled) {
        const at = now().getTime();
        for (const [host, resumeAt] of postponed) {
          if (resumeAt <= at) {
            postponed.delete(host);
          }
        }
        const result = await pollOnce(paths, { ...deps, now, notBefore: postponed });
        for (const [host, resumeAt] of Object.entries(result.postponed)) {
          postponed.set(host, resumeAt);
        }
      }
    } catch (error) {
      // A background job must not take the server down; the next cycle tries again.
      console.error('ravi notifications poll failed:', error instanceof Error ? error.message : String(error));
    } finally {
      running = false;
      schedule(delay);
    }
  };

  // Poll soon after startup instead of waiting a whole interval; later cycles use the setting.
  schedule(0);
  return {
    stop() {
      stopped = true;
      timer.clear(handle);
    },
  };
}
