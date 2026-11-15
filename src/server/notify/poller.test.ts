import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { Repo } from '../../shared/api.ts';
import { SettingsSchema } from '../../shared/api.ts';
import type { PullRequestSummary, RemoteComment, Thread } from '../../shared/forge.ts';
import { ForgeError } from '../forges/http.ts';
import { fakeFetch } from '../forges/testing.ts';
import { fakeForge } from '../pulls/testing.ts';
import { resolvePaths } from '../paths.ts';
import { writeJsonFile } from '../store/json-file.ts';
import { pollOnce } from './poller.ts';
import { listNotifications, readNotificationStore } from './store.ts';

const START = Date.parse('2026-11-14T10:00:00.000Z');
const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

async function makePaths(repos: Repo[]): Promise<ReturnType<typeof resolvePaths>> {
  const home = mkdtempSync(join(tmpdir(), 'revu-notify-'));
  tempDirs.push(home);
  const paths = resolvePaths({ REVU_HOME: home });
  await writeJsonFile(join(paths.data, 'repos.json'), repos);
  return paths;
}

function repo(id: string, project = 'acme/api'): Repo {
  return {
    id,
    path: join(tmpdir(), 'revu-notify-checkout', id),
    name: id,
    lastUsedAt: '2026-11-14T10:00:00.000Z',
    kind: 'local',
    remote: { host: 'github.com', project },
  };
}

function pullRequest(number = 7): PullRequestSummary {
  return {
    number,
    title: 'Add b',
    author: 'octocat',
    state: 'open',
    draft: false,
    updatedAt: '2026-11-14T10:00:00.000Z',
    baseRef: 'main',
    headRef: 'feature',
    headSha: 'h1',
    webUrl: `https://github.com/acme/api/pull/${number}`,
    commentCount: 0,
  };
}

function comment(id: string, author: string, body: string, createdAt = '2026-11-14T09:00:00.000Z'): RemoteComment {
  return { id, author, body, createdAt, updatedAt: createdAt, canEdit: false };
}

function thread(id: string, comments: RemoteComment[]): Thread {
  return {
    id,
    path: null,
    side: 'new',
    line: null,
    startLine: null,
    outdated: false,
    resolved: false,
    comments,
  };
}

describe('pollOnce', () => {
  it('records a baseline, then notifies only new comments that pass the rules', async () => {
    const paths = await makePaths([repo('a1b2c3d4')]);
    const comments = [comment('c1', 'alice', 'first'), comment('c2', 'bob', 'second')];
    const pullRequests = [pullRequest()];
    let listCalls = 0;
    const forge = fakeForge({
      currentUser: () => Promise.resolve('octocat'),
      listPullRequests: () => {
        listCalls += 1;
        return Promise.resolve(pullRequests);
      },
      listThreads: () => Promise.resolve([thread('t1', comments)]),
    });
    const clock = { current: START };
    const deps = { forgeFor: () => Promise.resolve(forge), now: () => new Date(clock.current) };

    const first = await pollOnce(paths, deps);
    expect(first.postponed).toEqual({});
    expect((await listNotifications(paths)).items).toEqual([]);
    expect((await readNotificationStore(paths)).recent).toHaveLength(2);
    expect((await readNotificationStore(paths)).markers['github.com|acme/api|7']?.seenIds).toEqual(['c1', 'c2']);

    await writeJsonFile(
      join(paths.data, 'settings.json'),
      SettingsSchema.parse({ notifications: { mutedAuthors: ['muted-user'] } }),
    );

    clock.current += 5 * 60_000;
    comments.push(
      comment('c3', 'carol', 'Please\n\nreview', '2026-11-14T10:01:00.000Z'),
      comment('c4', 'muted-user', 'muted text', '2026-11-14T10:02:00.000Z'),
      comment('c5', 'octocat', 'my own comment', '2026-11-14T10:03:00.000Z'),
    );

    const second = await pollOnce(paths, deps);
    const secondItems = (await listNotifications(paths)).items;
    expect(second.postponed).toEqual({});
    expect(secondItems).toHaveLength(1);
    expect(secondItems[0]?.author).toBe('carol');
    expect(secondItems[0]?.excerpt).toBe('Please review');
    expect(secondItems[0]?.read).toBe(false);
    expect((await readNotificationStore(paths)).recent).toHaveLength(5);

    clock.current += 5 * 60_000;
    await pollOnce(paths, deps);
    expect((await listNotifications(paths)).items).toHaveLength(1);
    expect(listCalls).toBe(3);
  });

  it('asks each forge for my open pull requests only', async () => {
    const paths = await makePaths([repo('a1b2c3d4')]);
    const seen: unknown[] = [];
    const forge = fakeForge({
      currentUser: () => Promise.resolve('octocat'),
      listPullRequests: (_repo, options) => {
        seen.push(options);
        return Promise.resolve([]);
      },
    });

    await pollOnce(paths, { forgeFor: () => Promise.resolve(forge), now: () => new Date(START) });

    expect(seen).toEqual([{ state: 'open', author: 'octocat' }]);
  });

  it('polls two repositories sharing one remote exactly once', async () => {
    const paths = await makePaths([repo('a1b2c3d4'), repo('b2c3d4e5')]);
    let listCalls = 0;
    let userCalls = 0;
    const forge = fakeForge({
      currentUser: () => {
        userCalls += 1;
        return Promise.resolve('octocat');
      },
      listPullRequests: () => {
        listCalls += 1;
        return Promise.resolve([pullRequest()]);
      },
      listThreads: () => Promise.resolve([]),
    });

    await pollOnce(paths, { forgeFor: () => Promise.resolve(forge), now: () => new Date(START) });

    expect(userCalls).toBe(1);
    expect(listCalls).toBe(1);
  });

  it('reports a retry-after so the host is skipped until it expires', async () => {
    const paths = await makePaths([repo('a1b2c3d4')]);
    let listCalls = 0;
    const forge = fakeForge({
      currentUser: () => Promise.resolve('octocat'),
      listPullRequests: () => {
        listCalls += 1;
        return Promise.reject(new ForgeError(429, 'rate limited', 30));
      },
    });
    const clock = { current: START };
    const deps = { forgeFor: () => Promise.resolve(forge), now: () => new Date(clock.current) };

    const blocked = await pollOnce(paths, deps);
    expect(listCalls).toBe(1);
    expect(blocked.postponed['github.com']).toBe(START + 30_000);

    const skipped = await pollOnce(paths, {
      ...deps,
      notBefore: new Map(Object.entries(blocked.postponed)),
    });
    expect(skipped.postponed).toEqual({});
    expect(listCalls).toBe(1);

    // Once the retry time has passed the host is polled again.
    clock.current = START + 31_000;
    await pollOnce(paths, {
      ...deps,
      notBefore: new Map(Object.entries(blocked.postponed)),
    });
    expect(listCalls).toBe(2);
  });

  it('keeps a broken pull request from stopping the others', async () => {
    const paths = await makePaths([repo('a1b2c3d4')]);
    const secondPullRequestComments = [comment('c9', 'dave', 'still works')];
    const forge = fakeForge({
      currentUser: () => Promise.resolve('octocat'),
      listPullRequests: () => Promise.resolve([pullRequest(1), pullRequest(2)]),
      listThreads: (_repo, number) => {
        if (number === 1) {
          return Promise.reject(new Error('thread endpoint exploded'));
        }
        return Promise.resolve([thread('t2', secondPullRequestComments)]);
      },
    });
    const clock = { current: START };
    const deps = { forgeFor: () => Promise.resolve(forge), now: () => new Date(clock.current) };

    // PR 1 throws before it can record a marker; PR 2 still gets its baseline.
    await pollOnce(paths, deps);
    expect((await readNotificationStore(paths)).markers['github.com|acme/api|1']).toBeUndefined();
    expect((await readNotificationStore(paths)).markers['github.com|acme/api|2']).toBeDefined();

    secondPullRequestComments.push(comment('c10', 'erin', 'second poll works', '2026-11-14T10:01:00.000Z'));
    clock.current += 60_000;
    await pollOnce(paths, deps);
    expect((await listNotifications(paths)).items[0]?.author).toBe('erin');
  });

  it('polls with the repository token, not the host token', async () => {
    const paths = await makePaths([repo('a1b2c3d4')]);
    writeFileSync(
      paths.envFile,
      'GITHUB_TOKEN=host-token-111\nREVU_TOKEN_A1B2C3D4=repo-token-222\n',
    );
    const fake = fakeFetch({
      'GET https://api.github.com/user': { json: { login: 'octocat' } },
      'GET https://api.github.com/repos/acme/api/pulls?state=open&per_page=100': {
        json: [
          {
            number: 7,
            title: 'Add b',
            user: { login: 'octocat' },
            state: 'open',
            draft: false,
            updated_at: '2026-11-14T10:00:00Z',
            base: { ref: 'main', sha: 'b1' },
            head: { ref: 'feature', sha: 'h1' },
            html_url: 'https://github.com/acme/api/pull/7',
            merged_at: null,
            requested_reviewers: [],
          },
        ],
      },
      'GET https://api.github.com/repos/acme/api/pulls/7/comments?per_page=100': { json: [] },
      'GET https://api.github.com/repos/acme/api/issues/7/comments?per_page=100': { json: [] },
    });
    vi.stubGlobal('fetch', fake);
    try {
      // No `forgeFor` override: the default lookup must select the repository token by itself.
      await pollOnce(paths, { now: () => new Date(START) });
    } finally {
      vi.unstubAllGlobals();
    }

    expect(fake.calls.length).toBeGreaterThan(0);
    for (const call of fake.calls) {
      expect(call.headers.authorization).toBe('Bearer repo-token-222');
    }
  });
});
