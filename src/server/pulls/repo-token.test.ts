/**
 * Behaviour proof that pull request routes use a repository's own token.
 *
 * The tests drive the real `defaultForgeLookup` (no fake forge): the only substitution is the global
 * `fetch`, which records the `authorization` header of every request. Both `GITHUB_TOKEN` and
 * `RAVI_TOKEN_<REPOID>` are present in the temporary `.env`, so the host token would win if the route
 * forgot to pass the repository id.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Repo } from '../../shared/api.ts';
import { fakeFetch } from '../forges/testing.ts';
import type { FakeFetch } from '../forges/testing.ts';
import { resolvePaths } from '../paths.ts';
import { writeJsonFile } from '../store/json-file.ts';
import { openPullRequest } from './open.ts';
import { listPullRequests } from './query.ts';

const REPO_ID = 'a1b2c3d4';
const REPO_TOKEN = 'repo-token-222';
const HOST_TOKEN = 'host-token-111';
const NUMBER = 7;
const API = 'https://api.github.com';
const PROJECT = '/repos/acme/api';
const PULL = `${PROJECT}/pulls/${NUMBER}`;

const tempDirs: string[] = [];
let source = '';
let baseSha = '';
let headSha = '';

function git(cwd: string, args: string[]): string {
  return execFileSync(
    'git',
    [
      '-c', 'user.name=ravi test',
      '-c', 'user.email=ravi@example.com',
      '-c', 'commit.gpgsign=false',
      '-c', 'core.autocrlf=false',
      ...args,
    ],
    { cwd, encoding: 'utf8' },
  );
}

function temp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `ravi-${prefix}-`));
  tempDirs.push(dir);
  return dir;
}

beforeAll(() => {
  source = temp('repo-token-source');
  git(source, ['init', '-q', '-b', 'main']);
  writeFileSync(join(source, 'a.txt'), 'one\n');
  git(source, ['add', '.']);
  git(source, ['commit', '--no-verify', '-q', '-m', 'base']);
  baseSha = git(source, ['rev-parse', 'HEAD']).trim();

  writeFileSync(join(source, 'a.txt'), 'two\n');
  writeFileSync(join(source, 'b.txt'), 'new\n');
  git(source, ['add', '.']);
  git(source, ['commit', '--no-verify', '-q', '-m', 'pull request']);
  headSha = git(source, ['rev-parse', 'HEAD']).trim();
  git(source, ['update-ref', `refs/pull/${NUMBER}/head`, 'HEAD']);
  git(source, ['config', 'uploadpack.allowAnySHA1InWant', 'true']);
});

afterAll(() => {
  vi.unstubAllGlobals();
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A fresh home whose `.env` holds both tokens; the repository is connected with the default scope. */
async function makeHome(repoPath: string): Promise<ReturnType<typeof resolvePaths>> {
  const home = temp('repo-token-home');
  const paths = resolvePaths({ RAVI_HOME: home });
  writeFileSync(
    paths.envFile,
    `GITHUB_TOKEN=${HOST_TOKEN}\nRAVI_TOKEN_${REPO_ID.toUpperCase()}=${REPO_TOKEN}\n`,
  );
  const repo: Repo = {
    id: REPO_ID,
    path: repoPath,
    name: 'repo',
    lastUsedAt: '2026-11-15T10:00:00.000Z',
    kind: 'local',
    remote: { host: 'github.com', project: 'acme/api' },
    tokenScope: 'repo',
  };
  await writeJsonFile(join(paths.data, 'repos.json'), [repo]);
  return paths;
}

function pullDetails(): Record<string, unknown> {
  return {
    number: NUMBER,
    title: 'Add b',
    user: { login: 'octocat' },
    state: 'open',
    draft: false,
    updated_at: '2026-11-15T10:00:00Z',
    base: { ref: 'main', sha: baseSha },
    head: { ref: 'feature', sha: headSha },
    html_url: `https://github.com/acme/api/pull/${NUMBER}`,
    merged_at: null,
    body: '',
    comments: 0,
    review_comments: 0,
    requested_reviewers: [],
  };
}

function expectRepositoryToken(fake: FakeFetch): void {
  expect(fake.calls.length).toBeGreaterThan(0);
  for (const call of fake.calls) {
    expect(call.headers.authorization).toBe(`Bearer ${REPO_TOKEN}`);
  }
}

describe('repository token on pull request routes', () => {
  it('lists pull requests with RAVI_TOKEN_<REPOID>, not the host token', async () => {
    const paths = await makeHome(join(tmpdir(), 'ravi-repo-token-list'));
    const fake = fakeFetch({
      [`GET ${API}/user`]: { json: { login: 'octocat' } },
      [`GET ${API}${PROJECT}/pulls?state=open&per_page=100`]: { json: [pullDetails()] },
    });
    vi.stubGlobal('fetch', fake);
    try {
      const pulls = await listPullRequests(paths, REPO_ID, { state: 'open', mine: false });
      expect(pulls.map((pull) => pull.number)).toEqual([NUMBER]);
    } finally {
      vi.unstubAllGlobals();
    }

    expectRepositoryToken(fake);
  });

  it('opens a pull request with RAVI_TOKEN_<REPOID>, not the host token', async () => {
    const clone = temp('repo-token-clone');
    execFileSync('git', ['clone', '-q', pathToFileURL(source).href, clone], { cwd: tmpdir(), encoding: 'utf8' });
    const paths = await makeHome(clone);
    const fake = fakeFetch({
      [`GET ${API}/user`]: { json: { login: 'octocat' } },
      [`GET ${API}${PULL}`]: { json: pullDetails() },
      [`GET ${API}${PULL}/comments?per_page=100`]: { json: [] },
      [`GET ${API}${PROJECT}/issues/${NUMBER}/comments?per_page=100`]: { json: [] },
    });
    vi.stubGlobal('fetch', fake);

    try {
      const result = await openPullRequest(paths, REPO_ID, NUMBER);
      expect(result.pullRequest.headSha).toBe(headSha);
      expect(result.threads).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }

    expectRepositoryToken(fake);
  });
});
