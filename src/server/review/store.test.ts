import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { ReviewComment, ReviewDocument, ReviewTarget } from '../../shared/review.ts';
import { resolvePaths } from '../paths.ts';
import { emptyReview, readReview, reviewKey, writeReview } from './store.ts';

const home = mkdtempSync(join(tmpdir(), 'ravi-review-'));
const paths = resolvePaths({ RAVI_HOME: home });
const REPO_ID = 'a1b2c3d4';

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
});

function comment(overrides: Partial<ReviewComment> & Pick<ReviewComment, 'id' | 'body'>): ReviewComment {
  return {
    parentId: null,
    path: 'src/a.ts',
    side: 'new',
    line: 2,
    startLine: null,
    author: null,
    state: 'draft',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    codeContext: null,
    outdated: false,
    ...overrides,
  };
}

const PR: ReviewTarget = { kind: 'pullRequest', host: 'github.com', project: 'acme/api', number: 12, forge: 'github' };

describe('reviewKey', () => {
  it('hashes a local target into a fixed-width safe name', () => {
    const local: ReviewTarget = { kind: 'local', repoPath: 'C:/repo', target: 'uncommitted' };
    const key = reviewKey(local);
    expect(key).toMatch(/^local-[a-f0-9]{16}$/);
    expect(reviewKey({ ...local })).toBe(key);
    expect(reviewKey({ ...local, target: 'branch:main' })).not.toBe(key);
  });

  it('flattens a hostile project name into one safe file name', () => {
    const hostile: ReviewTarget = { kind: 'pullRequest', host: 'gitlab.example.com', project: '../team:api', number: 7, forge: 'gitlab' };
    const key = reviewKey(hostile);
    expect(key).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(key).not.toContain('/');
    expect(key).not.toContain('\\');
    expect(key).not.toContain('..');
    expect(key.startsWith('gitlab-')).toBe(true);
    expect(key.endsWith('-7')).toBe(true);
  });
});

describe('review store', () => {
  it('writes and reads back the same document', async () => {
    const local: ReviewTarget = { kind: 'local', repoPath: 'C:/repo', target: 'uncommitted' };
    const doc: ReviewDocument = {
      version: 1,
      target: local,
      baseSha: null,
      headSha: 'a83e0b1',
      action: 'comment',
      summary: 'One note.',
      comments: [comment({ id: 'l-1', body: 'hello' })],
    };

    await writeReview(paths, REPO_ID, doc);
    await expect(readReview(paths, REPO_ID, local)).resolves.toEqual(doc);
    expect(join(paths.data, 'reviews', REPO_ID, `${reviewKey(local)}.json`)).toContain(REPO_ID);
  });

  it('returns an empty document for a target without a file', async () => {
    const missing: ReviewTarget = { kind: 'pullRequest', host: 'github.com', project: 'acme/missing', number: 99, forge: 'github' };
    await expect(readReview(paths, REPO_ID, missing)).resolves.toEqual(emptyReview(missing));
  });

  it('rejects a repository id that could escape the data folder', async () => {
    const doc: ReviewDocument = emptyReview(PR);
    await expect(readReview(paths, '../../etc', PR)).rejects.toThrow('Invalid repository id');
    await expect(writeReview(paths, 'ABCDEF12', doc)).rejects.toThrow('Invalid repository id');
  });
});
