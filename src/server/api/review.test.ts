import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import type { ReviewDocument } from '../../shared/review.ts';
import { Router } from '../http/router.ts';
import type { RequestContext } from '../http/router.ts';
import { resolvePaths } from '../paths.ts';
import { writeJsonFile } from '../store/json-file.ts';
import { registerReviewRoutes } from './review.ts';

const home = mkdtempSync(join(tmpdir(), 'revu-review-api-'));
const paths = resolvePaths({ REVU_HOME: home });
const repo = mkdtempSync(join(tmpdir(), 'revu-review-repo-'));
const REPO_ID = 'a1b2c3d4';

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
});

function git(args: string[]): string {
  return execFileSync(
    'git',
    [
      '-c', 'user.name=revu test',
      '-c', 'user.email=revu@example.com',
      '-c', 'commit.gpgsign=false',
      '-c', 'core.autocrlf=false',
      ...args,
    ],
    { cwd: repo, encoding: 'utf8' },
  );
}

function call(router: Router, method: string, path: string, payload: unknown): Promise<unknown> {
  const match = router.match(method, path);
  if (match === null) {
    throw new Error(`No route ${method} ${path}`);
  }
  return Promise.resolve(
    match.handler({
      req: {} as RequestContext['req'],
      params: match.params,
      query: new URLSearchParams(),
      body: <S extends z.ZodType>(schema: S): Promise<z.infer<S>> => Promise.resolve(schema.parse(payload)),
    }),
  );
}

describe('POST /api/reviews/export', () => {
  it('quotes exactly the comment lines and turns an asset link into an absolute path', async () => {
    git(['init', '-b', 'main']);
    writeFileSync(join(repo, 'a.txt'), 'one\ntwo\nthree\nfour\nfive\n');
    git(['add', '.']);
    git(['commit', '--no-verify', '-m', 'initial']);
    await writeJsonFile(join(paths.data, 'repos.json'), [
      { id: REPO_ID, path: repo, name: 'repo', lastUsedAt: '2026-11-14T10:00:00.000Z' },
    ]);

    const assetId = `${'a'.repeat(64)}.png`;
    const document: ReviewDocument = {
      version: 1,
      target: { kind: 'local', repoPath: repo, target: 'uncommitted' },
      baseSha: null,
      headSha: null,
      action: null,
      summary: null,
      comments: [
        {
          id: 'l-1',
          parentId: null,
          path: 'a.txt',
          side: 'new',
          line: 3,
          startLine: 2,
          body: `Screenshot: ![shot](asset:${assetId})`,
          author: null,
          state: 'draft',
          createdAt: '2026-11-14T10:00:00.000Z',
          updatedAt: '2026-11-14T10:00:00.000Z',
          codeContext: null,
          outdated: false,
        },
      ],
    };

    const router = new Router();
    registerReviewRoutes(router, { paths });
    const response = (await call(router, 'POST', '/api/reviews/export', {
      repoId: REPO_ID,
      diffTarget: { kind: 'uncommitted' },
      document,
    })) as { markdown: string };

    expect(response.markdown).toContain('```\ntwo\nthree\n```');
    expect(response.markdown).not.toContain('```\none\n');
    expect(response.markdown).toContain(join(paths.assets, assetId));
    expect(response.markdown).not.toContain(`asset:${assetId}`);
  });

  it('leaves asset links inside fenced and inline code unchanged', async () => {
    const assetId = `${'b'.repeat(64)}.png`;
    const body = [
      `outside ![shot](asset:${assetId})`,
      '```text',
      `inside ![code](asset:${assetId})`,
      '```',
      `inline \`![inline](asset:${assetId})\``,
    ].join('\n');
    const document: ReviewDocument = {
      version: 1,
      target: { kind: 'local', repoPath: repo, target: 'uncommitted' },
      baseSha: null,
      headSha: null,
      action: null,
      summary: null,
      comments: [
        {
          id: 'l-2',
          parentId: null,
          path: 'a.txt',
          side: 'new',
          line: 1,
          startLine: null,
          body,
          author: null,
          state: 'draft',
          createdAt: '2026-11-14T10:00:00.000Z',
          updatedAt: '2026-11-14T10:00:00.000Z',
          codeContext: null,
          outdated: false,
        },
      ],
    };

    const router = new Router();
    registerReviewRoutes(router, { paths });
    const response = (await call(router, 'POST', '/api/reviews/export', {
      repoId: REPO_ID,
      diffTarget: { kind: 'uncommitted' },
      document,
    })) as { markdown: string };

    expect(response.markdown).toContain(join(paths.assets, assetId));
    expect(response.markdown.split(`asset:${assetId}`).length - 1).toBe(2);
  });
});
