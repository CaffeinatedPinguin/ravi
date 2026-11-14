import { describe, expect, it } from 'vitest';
import { describeForgeContract } from './contract.ts';
import type { ForgeHost } from './forge.ts';
import { createGitHubForge } from './github.ts';
import { createGitLabForge } from './gitlab.ts';
import { createForgeHttp } from './http.ts';
import { fakeFetch } from './testing.ts';

const githubHost: ForgeHost = {
  host: 'github.com',
  kind: 'github',
  apiUrl: 'https://api.github.com',
  webUrl: 'https://github.com',
  tokenEnv: 'GITHUB_TOKEN',
  auth: () => undefined,
};

const gitlabHost: ForgeHost = {
  host: 'gitlab.com',
  kind: 'gitlab',
  apiUrl: 'https://gitlab.com/api/v4',
  webUrl: 'https://gitlab.com',
  tokenEnv: 'GITLAB_TOKEN',
  auth: () => undefined,
};

const repo = { host: 'github.com', project: 'acme/api' };
const http = createForgeHttp({ apiUrl: 'https://api.github.com', auth: () => undefined });

describeForgeContract('GitHub skeleton', {
  create: () => createGitHubForge(githubHost, http),
  repo,
  pullRequest: 7,
});

describeForgeContract('GitLab skeleton', {
  create: () => createGitLabForge(gitlabHost, http),
  repo: { host: 'gitlab.com', project: 'group/sub/api' },
  pullRequest: 9,
});

describe('strategy skeletons', () => {
  it('build exact GitHub URLs and refs', () => {
    const forge = createGitHubForge(githubHost, http);
    expect(forge.pullRequestRef(7)).toBe('pull/7/head');
    expect(forge.webUrl(repo, 'abc123', 'src/hello world.ts', 12)).toBe(
      'https://github.com/acme/api/blob/abc123/src/hello%20world.ts#L12',
    );
    expect(forge.cloneUrl(repo)).toBe('https://github.com/acme/api.git');
  });

  it('build exact GitLab URLs and refs, including nested groups', () => {
    const forge = createGitLabForge(gitlabHost, http);
    const gitlabRepo = { host: 'gitlab.com', project: 'group/sub/api' };
    expect(forge.pullRequestRef(9)).toBe('merge-requests/9/head');
    expect(forge.webUrl(gitlabRepo, 'abc123', 'src/hello world.ts')).toBe(
      'https://gitlab.com/group/sub/api/-/blob/abc123/src/hello%20world.ts',
    );
    expect(forge.cloneUrl(gitlabRepo)).toBe('https://gitlab.com/group/sub/api.git');
  });
});

describe('fakeFetch', () => {
  it('records the request and returns the configured answer', async () => {
    const fake = fakeFetch({
      'GET https://api.test/x': { status: 200, headers: { etag: '"1"' }, json: { ok: true } },
    });

    const response = await fake('https://api.test/x', { method: 'GET', headers: { accept: 'application/json' } });

    expect(response.status).toBe(200);
    expect(response.headers.get('etag')).toBe('"1"');
    expect(await response.json()).toEqual({ ok: true });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]).toMatchObject({ method: 'GET', url: 'https://api.test/x', body: null });
    expect(fake.fetch).toBe(fake);
  });

  it('computes a route from the recorded call', async () => {
    const fake = fakeFetch({
      'POST https://api.test/x': (call) => ({ status: 201, json: { echoed: call.body } }),
    });

    const response = await fake('https://api.test/x', { method: 'POST', body: '{"a":1}' });

    expect(await response.json()).toEqual({ echoed: '{"a":1}' });
  });

  it('fails the test on an unknown request', async () => {
    const fake = fakeFetch({});
    await expect(fake('https://api.test/unknown', { method: 'GET' })).rejects.toThrow(/Unexpected request/);
  });
});
