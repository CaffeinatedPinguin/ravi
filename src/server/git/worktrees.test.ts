import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { listWorktrees, parseWorktrees, samePath, worktreeRoot } from './worktrees.ts';

const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function temp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `ravi-${prefix}-`));
  tempDirs.push(dir);
  return dir;
}

/** Git with a fixed identity and no hooks, so the host configuration cannot interfere. */
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

/** One commit plus a linked worktree on its own branch. */
function repoWithWorktree(): { repo: string; linked: string } {
  const repo = temp('worktrees-repo');
  git(repo, ['init', '-q', '-b', 'main']);
  writeFileSync(join(repo, 'a.txt'), 'one\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '--no-verify', '-q', '-m', 'initial']);
  const linked = join(temp('worktrees-linked'), 'wt');
  git(repo, ['worktree', 'add', '-q', '-b', 'topic', linked]);
  return { repo, linked };
}

const MAIN_SHA = '1'.repeat(40);
const TOPIC_SHA = '2'.repeat(40);
const DETACHED_SHA = '3'.repeat(40);
const STALE_SHA = '4'.repeat(40);

/** The byte layout of `git worktree list --porcelain -z`: NUL after every attribute, one more per record. */
const SAMPLE =
  `worktree C:/ravi/main\0HEAD ${MAIN_SHA}\0branch refs/heads/main\0\0` +
  `worktree C:/ravi/linked work\0HEAD ${TOPIC_SHA}\0branch refs/heads/topic\0\0` +
  `worktree C:/ravi/detached\0HEAD ${DETACHED_SHA}\0detached\0\0` +
  'worktree C:/ravi/bare.git\0bare\0\0' +
  `worktree C:/ravi/stale\0HEAD ${STALE_SHA}\0detached\0prunable gitdir file points to non-existent location\0\0`;

describe('parseWorktrees', () => {
  it('parses the porcelain -z sample and drops bare and prunable records', () => {
    const worktrees = parseWorktrees(SAMPLE, 'C:/ravi/main');

    expect(worktrees).toEqual([
      { path: 'C:/ravi/main', branch: 'main', head: MAIN_SHA, main: true, current: true },
      // A folder name may contain spaces; only the first space separates attribute from value.
      { path: 'C:/ravi/linked work', branch: 'topic', head: TOPIC_SHA, main: false, current: false },
      { path: 'C:/ravi/detached', branch: null, head: DETACHED_SHA, main: false, current: false },
    ]);
  });
});

describe('listWorktrees', () => {
  it('lists the connected folder and its linked worktree with the right flags', async () => {
    const { repo, linked } = repoWithWorktree();

    const worktrees = await listWorktrees(repo);

    expect(worktrees).toHaveLength(2);
    expect(worktrees[0]).toMatchObject({ branch: 'main', main: true, current: true });
    expect(worktrees[1]).toMatchObject({ branch: 'topic', main: false, current: false });
    expect(samePath(worktrees[1]?.path ?? '', linked)).toBe(true);
  });

  it('answers an empty list for a folder that is not a repository', async () => {
    expect(await listWorktrees(temp('worktrees-plain'))).toEqual([]);
  });
});

describe('worktreeRoot', () => {
  it('keeps the connected folder when nothing is requested', async () => {
    const { repo } = repoWithWorktree();

    expect(await worktreeRoot(repo, undefined)).toBe(repo);
  });

  it('resolves a listed worktree to the path git printed', async () => {
    const { repo, linked } = repoWithWorktree();

    expect(samePath(await worktreeRoot(repo, linked), linked)).toBe(true);
  });

  it('rejects an unlisted folder and a sibling repository with 404', async () => {
    const { repo } = repoWithWorktree();
    const sibling = temp('worktrees-sibling');
    git(sibling, ['init', '-q', '-b', 'main']);

    await expect(worktreeRoot(repo, join(tmpdir(), 'ravi-not-a-worktree'))).rejects.toMatchObject({ status: 404 });
    await expect(worktreeRoot(repo, sibling)).rejects.toMatchObject({ status: 404 });
  });
});
