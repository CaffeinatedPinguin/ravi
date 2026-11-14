import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resolvePaths } from '../paths.ts';
import { HttpError } from '../http/router.ts';
import { reloadForgeTokens } from './env.ts';
import { HOSTS, forgeFor, forgeStatus } from './registry.ts';

const home = mkdtempSync(join(tmpdir(), 'revu-forge-registry-'));
const paths = resolvePaths({ REVU_HOME: home });
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
    expect(httpError.message).toBe('No token for github.com: add GITHUB_TOKEN to ~/.revu/.env');
  });

  it('builds the strategy for a registered host when the token exists', async () => {
    writeFileSync(paths.envFile, 'GITHUB_TOKEN=test-token-123\n');
    reloadForgeTokens();

    const forge = await forgeFor(paths, github);

    expect(forge.kind).toBe('github');
    expect(forge.capabilities.requestChanges).toBe(true);
  });
});

describe('forgeStatus', () => {
  it('reports hasToken without exposing the token value', async () => {
    writeFileSync(paths.envFile, 'GITHUB_TOKEN=test-token-123\n');
    reloadForgeTokens();

    const statuses = await forgeStatus(paths);
    expect(statuses).toHaveLength(2);
    expect(statuses.find((status) => status.host === 'github.com')?.hasToken).toBe(true);
    expect(statuses.find((status) => status.host === 'gitlab.com')?.hasToken).toBe(false);
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
