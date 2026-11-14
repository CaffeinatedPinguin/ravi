import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { Repo } from '../../shared/api.ts';
import type { PullRequest } from '../../shared/forge.ts';
import { resolvePaths } from '../paths.ts';
import { writeJsonFile } from '../store/json-file.ts';
import {
  addReviewLater,
  listReviewLater,
  refreshReviewLater,
  removeReviewLater,
} from './review-later.ts';
import { fakeForge } from './testing.ts';

const REPO_ID = 'a1b2c3d4';
const NUMBER = 7;
const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A fresh data folder with the repository already connected; the checkout itself is never touched. */
async function makePaths(): Promise<ReturnType<typeof resolvePaths>> {
  const home = mkdtempSync(join(tmpdir(), 'revu-review-later-'));
  tempDirs.push(home);
  const paths = resolvePaths({ REVU_HOME: home });
  const repo: Repo = {
    id: REPO_ID,
    path: join(home, 'checkout'),
    name: 'checkout',
    lastUsedAt: '2026-11-14T10:00:00.000Z',
    kind: 'local',
    remote: { host: 'github.com', project: 'acme/api' },
  };
  await writeJsonFile(join(paths.data, 'repos.json'), [repo]);
  return paths;
}

function pullRequest(headSha: string, state: PullRequest['state'] = 'open'): PullRequest {
  return {
    number: NUMBER,
    title: 'Add b',
    author: 'octocat',
    state,
    draft: false,
    updatedAt: '2026-11-14T10:00:00.000Z',
    baseRef: 'main',
    headRef: 'feature',
    headSha,
    webUrl: 'https://github.com/acme/api/pull/7',
    commentCount: 0,
    body: '',
    baseSha: 'b000000000000000000000000000000000000001',
    mergeBaseSha: null,
  };
}

describe('review later', () => {
  it('adds a pull request once, even when asked twice', async () => {
    const paths = await makePaths();
    const forge = fakeForge({ getPullRequest: () => Promise.resolve(pullRequest('h1')) });
    const forgeFor = () => Promise.resolve(forge);

    const first = await addReviewLater(paths, { repoId: REPO_ID, number: NUMBER }, { forgeFor });
    const second = await addReviewLater(paths, { repoId: REPO_ID, number: NUMBER }, { forgeFor });

    expect(first.title).toBe('Add b');
    expect(first.headShaAtAdd).toBe('h1');
    expect(second.addedAt).toBe(first.addedAt);
    expect(await listReviewLater(paths)).toHaveLength(1);
    expect((await listReviewLater(paths))[0]?.changedSinceAdded).toBe(false);
  });

  it('marks the entry changed when the head moved since it was added', async () => {
    const paths = await makePaths();
    let head = 'h1';
    const forge = fakeForge({ getPullRequest: () => Promise.resolve(pullRequest(head)) });
    const forgeFor = () => Promise.resolve(forge);
    await addReviewLater(paths, { repoId: REPO_ID, number: NUMBER }, { forgeFor });

    head = 'h2';
    const [entry] = await refreshReviewLater(paths, { forgeFor });

    expect(entry?.changedSinceAdded).toBe(true);
    expect(entry?.closed).toBe(false);
    expect(entry?.lastKnown?.headSha).toBe('h2');
  });

  it('keeps the previous status and reports an error when the forge call fails', async () => {
    const paths = await makePaths();
    let head = 'h1';
    let fail = false;
    const forge = fakeForge({
      getPullRequest: () =>
        fail ? Promise.reject(new Error('forge is down')) : Promise.resolve(pullRequest(head)),
    });
    const forgeFor = () => Promise.resolve(forge);
    await addReviewLater(paths, { repoId: REPO_ID, number: NUMBER }, { forgeFor });

    const [checked] = await refreshReviewLater(paths, { forgeFor });
    expect(checked?.lastKnown?.headSha).toBe('h1');
    expect(checked?.error).toBeUndefined();

    head = 'h2';
    fail = true;
    const [failed] = await refreshReviewLater(paths, { forgeFor });
    expect(failed?.error).toContain('forge is down');
    expect(failed?.lastKnown?.headSha).toBe('h1');
    expect(failed?.lastKnown?.checkedAt).toBe(checked?.lastKnown?.checkedAt);
  });

  it('deletes an entry', async () => {
    const paths = await makePaths();
    const forge = fakeForge({ getPullRequest: () => Promise.resolve(pullRequest('h1')) });
    const forgeFor = () => Promise.resolve(forge);
    await addReviewLater(paths, { repoId: REPO_ID, number: NUMBER }, { forgeFor });

    await removeReviewLater(paths, REPO_ID, NUMBER);

    expect(await listReviewLater(paths)).toEqual([]);
  });

  it('marks a closed pull request and keeps a merged one out of the open list', async () => {
    const paths = await makePaths();
    let state: PullRequest['state'] = 'open';
    const forge = fakeForge({ getPullRequest: () => Promise.resolve(pullRequest('h1', state)) });
    const forgeFor = () => Promise.resolve(forge);
    await addReviewLater(paths, { repoId: REPO_ID, number: NUMBER }, { forgeFor });

    state = 'merged';
    const [entry] = await refreshReviewLater(paths, { forgeFor });

    expect(entry?.closed).toBe(true);
  });
});
