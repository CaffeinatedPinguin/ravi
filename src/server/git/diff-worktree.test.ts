import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { diffSummary, readBlobLines } from './diff.ts';
import { diffFingerprint } from './fingerprint.ts';

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

/** Git with a fixed identity and no hooks; commits use `--no-verify` because the host has a hook. */
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

describe('diff of a linked worktree', () => {
  it('reviews that worktree’s edits and untracked files, leaving the connected folder untouched', async () => {
    const repo = temp('diff-worktree-repo');
    git(repo, ['init', '-q', '-b', 'main']);
    writeFileSync(join(repo, 'a.txt'), 'one\ntwo\n');
    git(repo, ['add', '.']);
    git(repo, ['commit', '--no-verify', '-q', '-m', 'initial']);
    const linked = join(temp('diff-worktree-linked'), 'wt');
    git(repo, ['worktree', 'add', '-q', '-b', 'topic', linked]);

    writeFileSync(join(linked, 'a.txt'), 'one\nchanged\n');
    writeFileSync(join(linked, 'new.txt'), 'brand new\n');
    const target = { kind: 'uncommitted' as const, worktree: linked };

    const summary = await diffSummary(repo, { target, ignoreWhitespace: false, includeUntracked: true });
    expect(summary.files.map((file) => file.path).sort()).toEqual(['a.txt', 'new.txt']);
    expect(summary.files.find((file) => file.path === 'new.txt')?.status).toBe('untracked');

    // Without the worktree the connected folder is reviewed, and it has nothing uncommitted.
    const mainSummary = await diffSummary(repo, {
      target: { kind: 'uncommitted' },
      ignoreWhitespace: false,
      includeUntracked: true,
    });
    expect(mainSummary.files).toEqual([]);

    // Another edit in the worktree must change the fingerprint even though the path is the same.
    const before = await diffFingerprint(repo, target);
    writeFileSync(join(linked, 'a.txt'), 'one\nchanged again\n');
    expect(await diffFingerprint(repo, target)).not.toBe(before);

    expect(await readBlobLines(repo, target, 'new', 'a.txt')).toEqual(['one', 'changed again']);
  });
});
