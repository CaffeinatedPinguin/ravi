import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Repo } from '../../shared/api.ts';
import type { DraftOperation, PullRequest, ReviewAction, SubmitResult } from '../../shared/forge.ts';
import type { ReviewComment, ReviewDocument } from '../../shared/review.ts';
import { resolvePaths } from '../paths.ts';
import { fakeForge } from '../pulls/testing.ts';
import { writeJsonFile } from '../store/json-file.ts';
import { readReview, writeReview } from '../review/store.ts';
import { sendReview } from './send.ts';

const REPO_ID = 'a1b2c3d4';
const NUMBER = 7;
const tempDirs: string[] = [];
let source = '';
let baseSha = '';
let headSha = '';

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
  source = mkdtempSync(join(tmpdir(), 'revu-send-source-'));
  tempDirs.push(source);
  git(source, ['init', '-b', 'main']);
  writeFileSync(join(source, 'a.txt'), 'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\n');
  git(source, ['add', '.']);
  git(source, ['commit', '--no-verify', '-m', 'base']);
  baseSha = git(source, ['rev-parse', 'HEAD']).trim();

  writeFileSync(join(source, 'a.txt'), 'one\ntwo\nthree\nfour\nFIVE\nsix\nseven\neight\n');
  writeFileSync(join(source, 'b.txt'), 'new file\n');
  git(source, ['add', '.']);
  git(source, ['commit', '--no-verify', '-m', 'pull request']);
  headSha = git(source, ['rev-parse', 'HEAD']).trim();
});

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function pullRequest(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    number: NUMBER,
    title: 'Change a and add b',
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

function comment(overrides: Partial<ReviewComment> & Pick<ReviewComment, 'id' | 'body'>): ReviewComment {
  return {
    parentId: null,
    path: null,
    side: 'new',
    line: null,
    startLine: null,
    author: null,
    state: 'draft',
    createdAt: '2026-11-14T10:00:00.000Z',
    updatedAt: '2026-11-14T10:00:00.000Z',
    codeContext: null,
    outdated: false,
    ...overrides,
  };
}

async function makeRepo(): Promise<{ paths: ReturnType<typeof resolvePaths> }> {
  const home = mkdtempSync(join(tmpdir(), 'revu-send-home-'));
  tempDirs.push(home);
  const paths = resolvePaths({ REVU_HOME: home });
  const repo: Repo = {
    id: REPO_ID,
    path: source,
    name: 'repo',
    lastUsedAt: '2026-11-14T10:00:00.000Z',
    kind: 'local',
    remote: { host: 'github.com', project: 'acme/api' },
  };
  await writeJsonFile(join(paths.data, 'repos.json'), [repo]);
  return { paths };
}

function reviewDocument(overrides: Partial<ReviewDocument> = {}): ReviewDocument {
  return {
    version: 1,
    target: { kind: 'pullRequest', host: 'github.com', project: 'acme/api', number: NUMBER, forge: 'github' },
    baseSha,
    headSha,
    action: 'requestChanges',
    summary: 'Please review',
    comments: [
      comment({ id: 'd1', path: 'a.txt', side: 'new', line: 3, body: 'body-should-not-be-logged-one' }),
      comment({ id: 'd1-reply', parentId: 'd1', path: 'a.txt', side: 'new', line: 3, body: 'folded-should-not-be-logged' }),
      comment({ id: 'd2', path: 'b.txt', side: 'new', line: 1, body: 'body-should-not-be-logged-two' }),
      comment({ id: 'p1', path: 'a.txt', side: 'new', line: 2, body: 'published stays', state: 'published' }),
    ],
    ...overrides,
  };
}

describe('sendReview', () => {
  it('removes successful drafts, keeps a failed one and logs counts without bodies', async () => {
    const { paths } = await makeRepo();
    await writeReview(paths, REPO_ID, reviewDocument());

    let submitted: DraftOperation[] = [];
    let sentAction: ReviewAction | null = null;
    let sentSummary: string | null = null;
    const results: SubmitResult[] = [
      { draftId: 'd1', ok: true, remoteId: 'r1' },
      { draftId: 'd2', ok: false, error: 'Rate limited' },
    ];
    const forge = fakeForge({
      getPullRequest: () => Promise.resolve(pullRequest()),
      submit: (_repo, _number, _pr, drafts, action, summary) => {
        submitted = drafts;
        sentAction = action;
        sentSummary = summary;
        return Promise.resolve(results);
      },
    });

    const response = await sendReview(paths, REPO_ID, NUMBER, { action: 'requestChanges', summary: 'Please review', force: false }, {
      forgeFor: () => Promise.resolve(forge),
    });

    // The folded reply rides inside d1 and has no operation of its own.
    expect(submitted.map((operation) => operation.draftId)).toEqual(['d1', 'd2']);
    expect(submitted[0]).toMatchObject({ op: 'comment', oldLine: 3, newLine: 3, body: 'body-should-not-be-logged-one\n\n> folded-should-not-be-logged' });
    expect(submitted[1]).toMatchObject({ op: 'comment', newLine: 1, oldLine: null });
    expect(sentAction).toBe('requestChanges');
    expect(sentSummary).toBe('Please review');

    expect(response.results).toEqual(results);
    expect(response.document.comments.map((item) => item.id)).toEqual(['d2', 'p1']);
    expect(response.document.comments.find((item) => item.id === 'd2')?.sendError).toBe('Rate limited');
    expect(response.document.summary).toBe('Please review');
    expect(response.document.action).toBe('requestChanges');

    // The persisted document is the one the answer describes.
    const stored = await readReview(paths, REPO_ID, reviewDocument().target);
    expect(stored.comments.map((item) => item.id)).toEqual(['d2', 'p1']);
    expect(stored.comments.find((item) => item.id === 'd2')?.sendError).toBe('Rate limited');

    const logFile = join(paths.data, 'send-log.jsonl');
    expect(existsSync(logFile)).toBe(true);
    const logText = readFileSync(logFile, 'utf8').trim();
    expect(logText.split('\n')).toHaveLength(1);
    const entry = JSON.parse(logText) as {
      repoId: string;
      number: number;
      action: string;
      operations: Record<string, number>;
      outcomes: Record<string, number>;
    };
    expect(entry).toMatchObject({
      repoId: REPO_ID,
      number: NUMBER,
      action: 'requestChanges',
      operations: { comment: 2, reply: 0, prComment: 0, edit: 0, delete: 0 },
      outcomes: { ok: 1, failed: 1 },
    });
    expect(logText).not.toContain('body-should-not-be-logged');
    expect(logText).not.toContain('folded-should-not-be-logged');
    expect(logText).not.toContain('published stays');
  });

  it('refuses a moved head without force and never calls submit', async () => {
    const { paths } = await makeRepo();
    await writeReview(paths, REPO_ID, reviewDocument({ headSha: 'stale-head' }));

    let submitCalls = 0;
    const forge = fakeForge({
      getPullRequest: () => Promise.resolve(pullRequest()),
      submit: () => {
        submitCalls += 1;
        return Promise.resolve([]);
      },
    });

    await expect(
      sendReview(paths, REPO_ID, NUMBER, { action: 'comment', summary: null, force: false }, { forgeFor: () => Promise.resolve(forge) }),
    ).rejects.toMatchObject({
      status: 409,
      message: 'The pull request changed since you opened it. Reload, or send anyway.',
    });
    expect(submitCalls).toBe(0);

    const stored = await readReview(paths, REPO_ID, reviewDocument({ headSha: 'stale-head' }).target);
    expect(stored.headSha).toBe('stale-head');
    expect(stored.comments.map((item) => item.id)).toEqual(['d1', 'd1-reply', 'd2', 'p1']);
    expect(existsSync(join(paths.data, 'send-log.jsonl'))).toBe(false);
  });

  it('sends with force even when the head moved', async () => {
    const { paths } = await makeRepo();
    await writeReview(paths, REPO_ID, reviewDocument({ headSha: null }));

    const forge = fakeForge({
      getPullRequest: () => Promise.resolve(pullRequest()),
      submit: (_repo, _number, _pr, drafts) => Promise.resolve(drafts.map((draft) => ({ draftId: draft.draftId, ok: true }))),
    });
    const response = await sendReview(paths, REPO_ID, NUMBER, { action: null, summary: null, force: true }, { forgeFor: () => Promise.resolve(forge) });

    expect(response.results).toHaveLength(2);
    expect(response.document.comments.map((item) => item.id)).toEqual(['p1']);
    expect(response.document.summary).toBeNull();
    expect(response.document.action).toBeNull();
  });
});
