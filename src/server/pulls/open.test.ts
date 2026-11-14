import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Repo } from '../../shared/api.ts';
import type { PullRequest } from '../../shared/forge.ts';
import { resolvePaths } from '../paths.ts';
import { writeJsonFile } from '../store/json-file.ts';
import { openPullRequest } from './open.ts';
import { fakeForge } from './testing.ts';

const REPO_ID = 'a1b2c3d4';
const NUMBER = 7;
const tempDirs: string[] = [];
let source = '';
let baseSha = '';
let headSha = '';

/** Git with a fixed identity and no hooks, so the host configuration cannot change the fixture. */
function git(cwd: string, args: string[]): string {
  return execFileSync(
    'git',
    [
      '-c', 'user.name=revu test',
      '-c', 'user.email=revu@example.com',
      '-c', 'commit.gpgsign=false',
      '-c', 'core.autocrlf=false',
      ...args,
    ],
    { cwd, encoding: 'utf8' },
  );
}

beforeAll(() => {
  source = mkdtempSync(join(tmpdir(), 'revu-open-source-'));
  tempDirs.push(source);
  git(source, ['init', '-b', 'main']);
  writeFileSync(join(source, 'a.txt'), 'one\n');
  git(source, ['add', '.']);
  git(source, ['commit', '--no-verify', '-m', 'base']);
  baseSha = git(source, ['rev-parse', 'HEAD']).trim();

  writeFileSync(join(source, 'a.txt'), 'two\n');
  writeFileSync(join(source, 'b.txt'), 'new\n');
  git(source, ['add', '.']);
  git(source, ['commit', '--no-verify', '-m', 'pull request']);
  headSha = git(source, ['rev-parse', 'HEAD']).trim();

  // What the forge exposes for a pull request; a clone does not fetch it until the review opens.
  git(source, ['update-ref', `refs/pull/${NUMBER}/head`, 'HEAD']);
  // A plain `file://` remote refuses lazy object requests unless it advertises them.
  git(source, ['config', 'uploadpack.allowAnySHA1InWant', 'true']);
});

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A local folder cloned from the fixture, connected to the fake forge in `repos.json`. */
async function makeRepo(): Promise<{ repo: Repo; paths: ReturnType<typeof resolvePaths> }> {
  const home = mkdtempSync(join(tmpdir(), 'revu-open-home-'));
  tempDirs.push(home);
  const root = mkdtempSync(join(tmpdir(), 'revu-open-clone-'));
  tempDirs.push(root);
  execFileSync('git', ['clone', pathToFileURL(source).href, root], { cwd: tmpdir(), encoding: 'utf8' });
  const paths = resolvePaths({ REVU_HOME: home });
  const repo: Repo = {
    id: REPO_ID,
    path: root,
    name: 'clone',
    lastUsedAt: '2026-11-14T10:00:00.000Z',
    kind: 'local',
    remote: { host: 'github.com', project: 'acme/api' },
  };
  await writeJsonFile(join(paths.data, 'repos.json'), [repo]);
  return { repo, paths };
}

function pullRequest(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    number: NUMBER,
    title: 'Add b',
    author: 'octocat',
    state: 'open',
    draft: false,
    updatedAt: '2026-11-14T10:00:00.000Z',
    baseRef: 'main',
    headRef: 'feature',
    headSha,
    webUrl: 'https://github.com/acme/api/pull/7',
    commentCount: 0,
    body: 'Please review',
    baseSha,
    mergeBaseSha: baseSha,
    ...overrides,
  };
}

describe('openPullRequest', () => {
  it('fetches the head, returns a merge-base range and the files the pull request changes', async () => {
    const { paths } = await makeRepo();
    const result = await openPullRequest(paths, REPO_ID, NUMBER, {
      forgeFor: () =>
        Promise.resolve(
          fakeForge({
            getPullRequest: () => Promise.resolve(pullRequest()),
            listThreads: () => Promise.resolve([]),
            currentUser: () => Promise.resolve('octocat'),
          }),
        ),
    });

    expect(result.diffTarget).toEqual({ kind: 'range', from: baseSha, to: headSha, mergeBase: true });
    expect(result.diffSummary.files.map((file) => file.path).sort()).toEqual(['a.txt', 'b.txt']);
    expect(result.pullRequest.headSha).toBe(headSha);
    expect(result.pullRequest.mergeBaseSha).toBe(baseSha);
    expect(result.warnings).toEqual([]);
    expect(result.currentUser).toBe('octocat');
    expect(result.reviewTarget).toEqual({
      kind: 'pullRequest',
      host: 'github.com',
      project: 'acme/api',
      number: NUMBER,
      forge: 'github',
    });
  });

  it('warns and keeps the fetched head when the forge reports an older commit', async () => {
    const { paths } = await makeRepo();
    const result = await openPullRequest(paths, REPO_ID, NUMBER, {
      forgeFor: () =>
        Promise.resolve(
          fakeForge({
            // The API call happened before a push: its metadata still names the base commit.
            getPullRequest: () => Promise.resolve(pullRequest({ headSha: baseSha })),
          }),
        ),
    });

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain(baseSha);
    expect(result.warnings[0]).toContain(headSha);
    expect(result.pullRequest.headSha).toBe(headSha);
    expect(result.diffSummary.files.map((file) => file.path).sort()).toEqual(['a.txt', 'b.txt']);
  });
});
