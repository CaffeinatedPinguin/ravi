import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { DraftOperation, PullRequest } from '../../shared/forge.ts';
import { resolvePaths } from '../paths.ts';
import { HttpError } from '../http/router.ts';
import { reloadForgeTokens } from './env.ts';
import { HOSTS, forgeFor, forgeStatus } from './registry.ts';
import { fakeFetch } from './testing.ts';

const home = mkdtempSync(join(tmpdir(), 'ravi-forge-registry-'));
const paths = resolvePaths({ RAVI_HOME: home });
const github = { host: 'github.com', project: 'acme/api' };

beforeEach(() => {
  writeFileSync(paths.envFile, '');
  reloadForgeTokens();
});

afterAll(() => {
  reloadForgeTokens();
  rmSync(home, { recursive: true, force: true });
});

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('Expected the call to fail');
    },
    (error: unknown) => error,
  );
}

describe('forgeFor', () => {
  it('rejects an unknown host with 400 before reading tokens', async () => {
    const error = await rejection(forgeFor(paths, { host: 'example.com', project: 'a/b' }));
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(400);
  });

  it('rejects a missing token with 401 naming the variable and the file', async () => {
    const error = await rejection(forgeFor(paths, github));
    expect(error).toBeInstanceOf(HttpError);
    const httpError = error as HttpError;
    expect(httpError.status).toBe(401);
    expect(httpError.message).toBe('No token for github.com: add GITHUB_TOKEN to ~/.ravi/.env');
  });

  it('builds the strategy for a registered host when the token exists', async () => {
    writeFileSync(paths.envFile, 'GITHUB_TOKEN=test-token-123\n');
    reloadForgeTokens();

    const forge = await forgeFor(paths, github);

    expect(forge.kind).toBe('github');
    expect(forge.capabilities.requestChanges).toBe(true);
  });

  it('uses the repository token before the host token', async () => {
    writeFileSync(paths.envFile, 'GITHUB_TOKEN=host-token-111\nRAVI_TOKEN_A1B2C3D4E5F6=repo-token-222\n');
    reloadForgeTokens();
    const fake = fakeFetch({ 'GET https://api.github.com/user': { json: { login: 'alice' } } });

    const forge = await forgeFor(paths, github, { repoId: 'a1b2c3d4e5f6', fetchImpl: fake });
    await expect(forge.currentUser()).resolves.toBe('alice');

    expect(fake.calls[0]?.headers.authorization).toBe('Bearer repo-token-222');
  });

  it('uses the host token when the repository is configured with host scope', async () => {
    writeFileSync(paths.envFile, 'GITHUB_TOKEN=host-token-111\nRAVI_TOKEN_A1B2C3D4E5F6=repo-token-222\n');
    reloadForgeTokens();
    const fake = fakeFetch({ 'GET https://api.github.com/user': { json: { login: 'alice' } } });

    const forge = await forgeFor(paths, github, {
      repoId: 'a1b2c3d4e5f6',
      tokenScope: 'host',
      fetchImpl: fake,
    });
    await expect(forge.currentUser()).resolves.toBe('alice');

    expect(fake.calls[0]?.headers.authorization).toBe('Bearer host-token-111');
  });

  it('wires uploads and image reads into the GitLab strategy', async () => {
    writeFileSync(paths.envFile, 'GITLAB_TOKEN=test-token-456\n');
    reloadForgeTokens();

    const project = 'group/sub/proj';
    const encoded = 'group%2Fsub%2Fproj';
    const api = 'https://gitlab.com/api/v4';
    const mrUrl = `${api}/projects/${encoded}/merge_requests/3`;
    const assetId = `${'a'.repeat(64)}.png`;
    mkdirSync(paths.assets, { recursive: true });
    writeFileSync(join(paths.assets, assetId), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const fake = fakeFetch({
      [`GET ${mrUrl}`]: {
        json: {
          iid: 3,
          title: 'MR 3',
          description: 'Body',
          author: { username: 'alice' },
          state: 'opened',
          draft: false,
          updated_at: '2026-01-01T00:00:00Z',
          source_branch: 'feature',
          target_branch: 'main',
          sha: 'head123',
          web_url: `https://gitlab.com/${project}/-/merge_requests/3`,
          diff_refs: { base_sha: 'base123', head_sha: 'head123', start_sha: 'start123' },
        },
      },
      [`POST ${api}/projects/${encoded}/uploads`]: {
        status: 201,
        json: { markdown: '![shot](https://gitlab.com/uploads/a/shot.png)' },
      },
      [`POST ${mrUrl}/draft_notes`]: { status: 201, json: { id: 11 } },
      [`POST ${mrUrl}/draft_notes/bulk_publish`]: { json: {} },
    });

    const forge = await forgeFor(paths, { host: 'gitlab.com', project }, { fetchImpl: fake });
    const pr: PullRequest = {
      number: 3,
      title: 'MR 3',
      author: 'alice',
      state: 'open',
      draft: false,
      updatedAt: '2026-01-01T00:00:00Z',
      baseRef: 'main',
      headRef: 'feature',
      headSha: 'head123',
      webUrl: `https://gitlab.com/${project}/-/merge_requests/3`,
      commentCount: null,
      body: 'Body',
      baseSha: 'base123',
      mergeBaseSha: 'base123',
    };
    const drafts: DraftOperation[] = [
      {
        op: 'comment',
        draftId: 'c1',
        path: 'src/a.ts',
        side: 'new',
        line: 1,
        startLine: null,
        body: `Shot: ![shot](asset:${assetId})`,
      },
    ];

    const results = await forge.submit({ host: 'gitlab.com', project }, 3, pr, drafts, null, null);

    expect(results).toEqual([{ draftId: 'c1', ok: true, remoteId: '11' }]);
    const upload = fake.calls.find((call) => call.url.endsWith('/uploads'));
    expect(upload?.method).toBe('POST');
    expect(upload?.headers['private-token']).toBe('test-token-456');
    const draft = fake.calls.find((call) => call.url === `${mrUrl}/draft_notes`);
    expect(draft?.body).toContain('![shot](https://gitlab.com/uploads/a/shot.png)');
    expect(draft?.body).not.toContain(`asset:${assetId}`);
  });
});

describe('forgeStatus', () => {
  it('reports hasToken without exposing the token value', async () => {
    writeFileSync(paths.envFile, 'GITHUB_TOKEN=test-token-123\n');
    reloadForgeTokens();

    const statuses = await forgeStatus(paths);
    expect(statuses).toHaveLength(2);
    const github = statuses.find((status) => status.host === 'github.com');
    expect(github?.hasToken).toBe(true);
    expect(github?.tokenHint).toBe('••••-123');
    expect(statuses.find((status) => status.host === 'gitlab.com')?.hasToken).toBe(false);
    expect(statuses.find((status) => status.host === 'gitlab.com')?.tokenHint).toBeNull();
    expect(JSON.stringify(statuses)).not.toContain('test-token-123');
  });

  it('exposes the host metadata used by the facade', () => {
    const githubHost = HOSTS.find((host) => host.kind === 'github');
    const gitlabHost = HOSTS.find((host) => host.kind === 'gitlab');
    expect(githubHost?.apiUrl).toBe('https://api.github.com');
    expect(gitlabHost?.apiUrl).toBe('https://gitlab.com/api/v4');

    const headers = new Headers();
    githubHost?.auth('test-token-123', headers);
    expect(headers.get('authorization')).toBe('Bearer test-token-123');
    expect(headers.get('x-github-api-version')).toBe('2026-03-10');

    const gitlabHeaders = new Headers();
    gitlabHost?.auth('test-token-456', gitlabHeaders);
    expect(gitlabHeaders.get('private-token')).toBe('test-token-456');
  });
});
