import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { diffFingerprint } from './fingerprint.ts';

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

function sha(root: string, ref: string): string {
  return git(root, ['rev-parse', '--verify', `${ref}^{commit}`]).trim();
}

/** Two commits touching the same tracked file, so both working-tree and range targets are meaningful. */
function makeRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'revu-fingerprint-'));
  git(root, ['init', '-b', 'main']);
  writeFileSync(join(root, 'a.txt'), 'one\n');
  git(root, ['add', '.']);
  git(root, ['commit', '--no-verify', '-m', 'one']);
  writeFileSync(join(root, 'a.txt'), 'two\n');
  git(root, ['add', '.']);
  git(root, ['commit', '--no-verify', '-m', 'two']);
  return root;
}

describe('diffFingerprint', () => {
  let root: string;

  beforeEach(() => {
    root = makeRepo();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('tracks content edits to already-modified files and new untracked files', async () => {
    const target = { kind: 'uncommitted' as const };

    writeFileSync(join(root, 'a.txt'), 'three\n');
    const afterFirstEdit = await diffFingerprint(root, target);
    // Nothing changed between two reads: focus refresh must stay quiet.
    expect(await diffFingerprint(root, target)).toBe(afterFirstEdit);

    // Same path, same status, and git prints a zero blob id for the worktree side: the fingerprint
    // only notices this second edit through the file's metadata (here the size also changes).
    writeFileSync(join(root, 'a.txt'), 'five!!\n');
    const afterSecondEdit = await diffFingerprint(root, target);
    expect(afterSecondEdit).not.toBe(afterFirstEdit);

    writeFileSync(join(root, 'new.txt'), 'untracked\n');
    const afterUntracked = await diffFingerprint(root, target);
    expect(afterUntracked).not.toBe(afterSecondEdit);
  });

  it('notices an mtime-only change without reading the file contents', async () => {
    const target = { kind: 'uncommitted' as const };
    writeFileSync(join(root, 'a.txt'), 'three\n');
    const before = await diffFingerprint(root, target);

    // Rewriting identical bytes keeps the size and the content; only the timestamp moves, as a
    // checkout or a tool touching the file can do. A byte hash would miss this, so metadata must
    // be part of the fingerprint.
    writeFileSync(join(root, 'a.txt'), 'three\n');
    const now = new Date();
    utimesSync(join(root, 'a.txt'), now, new Date(now.getTime() + 5000));
    expect(await diffFingerprint(root, target)).not.toBe(before);
  });

  it('describes a commit range by its two commit ids and ignores working-tree changes', async () => {
    const from = sha(root, 'HEAD~1');
    const to = sha(root, 'HEAD');
    const target = { kind: 'range' as const, from, to, mergeBase: false };

    expect(await diffFingerprint(root, target)).toBe(`${from}..${to}`);

    writeFileSync(join(root, 'a.txt'), 'working tree edit\n');
    writeFileSync(join(root, 'untracked.txt'), 'not in any commit\n');
    expect(await diffFingerprint(root, target)).toBe(`${from}..${to}`);
  });
});
