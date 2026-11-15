import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RepoRef } from '../../shared/forge.ts';
import { reloadForgeTokens } from '../forges/env.ts';
import { HttpError } from '../http/router.ts';
import { resolvePaths } from '../paths.ts';
import type { Paths } from '../paths.ts';
import { writeJsonFile } from '../store/json-file.ts';
import { listRepos } from '../store/repos.ts';
import { cloneEnv, cloneRemote, deleteClone, fetchPullRequest, httpsCloneUrl, listClones, pruneClones, sshCloneUrl } from './clone.ts';
import { diffSummary } from './diff.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const tempDirs: string[] = [];
let source = '';
let firstSha = '';
let secondSha = '';

/** Runs git in the fixture with a fixed identity and no hooks, so the host config cannot interfere. */
function git(root: string, args: string[]): string {
  return execFileSync(
    'git',
    [
      '-c', 'user.name=revu test',
      '-c', 'user.email=revu@example.com',
      '-c', 'commit.gpgsign=false',
      '-c', 'core.autocrlf=false',
      ...args,
    ],
    { cwd: root, encoding: 'utf8' },
  );
}

function makePaths(): Paths {
  const home = mkdtempSync(join(tmpdir(), 'revu-clone-'));
  tempDirs.push(home);
  return resolvePaths({ REVU_HOME: home });
}

/** Source repository with two commits and a fake pull request ref, served over `file://` only. */
beforeAll(() => {
  source = mkdtempSync(join(tmpdir(), 'revu-clone-source-'));
  tempDirs.push(source);
  git(source, ['init', '-b', 'main']);
  writeFileSync(join(source, 'a.txt'), 'one\n');
  git(source, ['add', '.']);
  git(source, ['commit', '--no-verify', '-m', 'one']);
  firstSha = git(source, ['rev-parse', 'HEAD']).trim();
  writeFileSync(join(source, 'a.txt'), 'two\n');
  git(source, ['add', '.']);
  git(source, ['commit', '--no-verify', '-m', 'two']);
  secondSha = git(source, ['rev-parse', 'HEAD']).trim();
  // A pull request head is a ref the forge exposes; the clone must not fetch it until asked.
  git(source, ['update-ref', 'refs/pull/7/head', 'HEAD']);
  // `git clone --filter` is only honoured when the serving side advertises it.
  git(source, ['config', 'uploadpack.allowFilter', 'true']);
  // Lazy blob downloads ask for an object id, which a plain file remote refuses by default.
  git(source, ['config', 'uploadpack.allowAnySHA1InWant', 'true']);
});

afterAll(() => {
  reloadForgeTokens();
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('cloneRemote and fetchPullRequest', () => {
  it('creates a bare blobless clone, fetches a PR head into the private namespace and diffs the range', async () => {
    const paths = makePaths();
    const ref: RepoRef = { host: 'github.com', project: 'acme/api' };

    await cloneRemote(paths, ref, { cloneUrl: pathToFileURL(source).href });

    const clone = join(paths.clones, 'github.com', 'acme__api.git');
    expect(existsSync(clone)).toBe(true);
    expect(git(clone, ['rev-parse', '--is-bare-repository']).trim()).toBe('true');
    expect(git(clone, ['config', '--get', 'remote.origin.promisor']).trim()).toBe('true');
    expect(git(clone, ['config', '--get', 'remote.origin.partialclonefilter']).trim()).toBe('blob:none');

    const headSha = await fetchPullRequest(clone, true, 'pull/7/head', 7);
    expect(headSha).toBe(secondSha);
    expect(git(clone, ['rev-parse', 'refs/revu/pr/7/head']).trim()).toBe(secondSha);

    // The diff must still work although file contents are not in the clone (they are fetched lazily).
    const summary = await diffSummary(clone, {
      target: { kind: 'range', from: firstSha, to: secondSha, mergeBase: false },
      ignoreWhitespace: false,
      includeUntracked: false,
    });
    expect(summary.files.map((file) => file.path)).toContain('a.txt');
    expect(summary.additions).toBe(1);
    expect(summary.deletions).toBe(1);
  });

  it('passes the token to an authenticated clone through GIT_CONFIG_* and never through argv', async () => {
    const paths = makePaths();
    const token = 'fake-token-abc123';
    writeFileSync(paths.envFile, `GITHUB_TOKEN=${token}\n`);
    reloadForgeTokens();

    const observed: Array<{ args: string[]; env: NodeJS.ProcessEnv }> = [];
    await cloneRemote(
      paths,
      { host: 'github.com', project: 'acme/api' },
      { cloneUrl: pathToFileURL(source).href, onSpawn: (info) => observed.push(info) },
    );

    const spawn = observed[0];
    expect(spawn).toBeDefined();
    if (spawn === undefined) {
      throw new Error('The clone child process was not observed');
    }

    const expected = Buffer.from(`x-access-token:${token}`, 'utf8').toString('base64');
    expect(spawn.env.GIT_CONFIG_COUNT).toBe('1');
    expect(spawn.env.GIT_CONFIG_KEY_0).toBe('http.https://github.com/.extraHeader');
    expect(spawn.env.GIT_CONFIG_VALUE_0).toBe(`Authorization: Basic ${expected}`);
    expect(spawn.args.join(' ')).not.toContain(token);

    // A child that inherits the same environment sees the header as command-scope configuration.
    // Git prints config keys lower-cased, so the expected entry uses `extraheader`.
    const output = execFileSync('git', ['config', '--get-regexp', 'http'], {
      cwd: source,
      encoding: 'utf8',
      env: { ...process.env, ...spawn.env },
    });
    expect(output).toContain('http.https://github.com/.extraheader');
    expect(output).toContain(`Authorization: Basic ${expected}`);
  });

  it('prefers the repository token over the host token for HTTPS', async () => {
    const paths = makePaths();
    writeFileSync(paths.envFile, 'GITHUB_TOKEN=host-token-123\nREVU_TOKEN_A1B2C3D4E5F6=repo-token-456\n');
    reloadForgeTokens();
    const ref: RepoRef = { host: 'github.com', project: 'acme/api' };

    const repository = await cloneEnv(paths, ref, { transport: 'https', repoId: 'a1b2c3d4e5f6' });
    const repositoryHeader = Buffer.from('x-access-token:repo-token-456', 'utf8').toString('base64');
    expect(repository.GIT_CONFIG_VALUE_0).toBe(`Authorization: Basic ${repositoryHeader}`);

    // A repository token that is not stored falls back to the host token.
    const fallback = await cloneEnv(paths, ref, { transport: 'https', repoId: 'ffffffffffff' });
    const hostHeader = Buffer.from('x-access-token:host-token-123', 'utf8').toString('base64');
    expect(fallback.GIT_CONFIG_VALUE_0).toBe(`Authorization: Basic ${hostHeader}`);
  });

  it('uses the SSH URL and injects neither a token nor GIT_CONFIG_* for an SSH clone', async () => {
    const paths = makePaths();
    const token = 'fake-token-ssh-123';
    writeFileSync(paths.envFile, `GITHUB_TOKEN=${token}\n`);
    reloadForgeTokens();
    const ref: RepoRef = { host: 'github.com', project: 'acme/api' };

    const observed: Array<{ args: string[]; env: NodeJS.ProcessEnv }> = [];
    await cloneRemote(paths, ref, {
      cloneUrl: pathToFileURL(source).href,
      transport: 'ssh',
      onSpawn: (info) => observed.push(info),
    });

    const spawn = observed[0];
    expect(spawn).toBeDefined();
    if (spawn === undefined) {
      throw new Error('The clone child process was not observed');
    }
    expect(spawn.env.GIT_CONFIG_COUNT).toBeUndefined();
    expect(spawn.env.GIT_CONFIG_KEY_0).toBeUndefined();
    for (const value of Object.values(spawn.env)) {
      expect(value ?? '').not.toContain(token);
    }

    expect(sshCloneUrl(ref)).toBe('git@github.com:acme/api.git');
    expect(httpsCloneUrl(ref)).toBe('https://github.com/acme/api.git');
  });
});

describe('deleteClone and pruneClones', () => {
  it('refuses to delete a folder that resolves outside the clone directory', async () => {
    const paths = makePaths();
    const outside = join(paths.home, 'outside');
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, 'keep.txt'), 'keep\n');
    await writeJsonFile(join(paths.data, 'repos.json'), [
      {
        id: 'a1b2c3d4e5f6',
        path: outside,
        name: 'outside',
        lastUsedAt: '2026-11-14T10:00:00.000Z',
        kind: 'remote',
        remote: { host: 'github.com', project: 'acme/api' },
      },
    ]);

    await expect(deleteClone(paths, 'a1b2c3d4e5f6')).rejects.toBeInstanceOf(HttpError);
    expect(existsSync(join(outside, 'keep.txt'))).toBe(true);
    expect(await listRepos(paths)).toHaveLength(1);
  });

  it('removes clones older than the retention and keeps recently used ones', async () => {
    const paths = makePaths();
    const now = new Date('2026-11-14T00:00:00.000Z');
    const oldFolder = join(paths.clones, 'github.com', 'old__repo.git');
    const newFolder = join(paths.clones, 'github.com', 'new__repo.git');
    mkdirSync(oldFolder, { recursive: true });
    mkdirSync(newFolder, { recursive: true });
    writeFileSync(join(oldFolder, 'pack'), Buffer.alloc(1024));
    writeFileSync(join(newFolder, 'pack'), Buffer.alloc(2048));
    await writeJsonFile(join(paths.data, 'repos.json'), [
      {
        id: '000000000001',
        path: oldFolder,
        name: 'old',
        lastUsedAt: new Date(now.getTime() - 31 * DAY_MS).toISOString(),
        kind: 'remote',
        remote: { host: 'github.com', project: 'old/repo' },
      },
      {
        id: '000000000002',
        path: newFolder,
        name: 'new',
        lastUsedAt: new Date(now.getTime() - 1 * DAY_MS).toISOString(),
        kind: 'remote',
        remote: { host: 'github.com', project: 'new/repo' },
      },
    ]);

    const before = await listClones(paths);
    expect(before).toHaveLength(2);
    expect(before.find((clone) => clone.repoId === '000000000001')?.sizeBytes).toBe(1024);
    expect(before.find((clone) => clone.repoId === '000000000002')?.project).toBe('new/repo');

    const removed = await pruneClones(paths, 30, now);

    expect(removed).toBe(1);
    expect(existsSync(oldFolder)).toBe(false);
    expect(existsSync(newFolder)).toBe(true);
    expect((await listRepos(paths)).map((repo) => repo.id)).toEqual(['000000000002']);
  });
});
