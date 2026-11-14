import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readForgeTokens, reloadForgeTokens } from './env.ts';

const home = mkdtempSync(join(tmpdir(), 'revu-forge-env-'));
const envFile = join(home, '.env');

beforeEach(() => {
  reloadForgeTokens();
  writeFileSync(envFile, 'GITHUB_TOKEN=test-token-123\nGITLAB_TOKEN=test-token-456\n');
});

afterEach(() => {
  delete process.env.GITHUB_TOKEN;
  reloadForgeTokens();
});

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
});

describe('readForgeTokens', () => {
  it('reads tokens from the env file and ignores process.env', async () => {
    process.env.GITHUB_TOKEN = 'from-process-must-be-ignored';

    const tokens = await readForgeTokens(envFile);

    expect(tokens.get('GITHUB_TOKEN')).toBe('test-token-123');
    expect(tokens.get('GITLAB_TOKEN')).toBe('test-token-456');
  });

  it('returns no tokens when the file is missing', async () => {
    const tokens = await readForgeTokens(join(home, 'missing.env'));
    expect(tokens.size).toBe(0);
  });

  it('caches the file until a reload, then picks up the change', async () => {
    expect((await readForgeTokens(envFile)).get('GITHUB_TOKEN')).toBe('test-token-123');

    writeFileSync(envFile, 'GITHUB_TOKEN=changed-token\n');
    expect((await readForgeTokens(envFile)).get('GITHUB_TOKEN')).toBe('test-token-123');

    reloadForgeTokens();
    const changed = await readForgeTokens(envFile);
    expect(changed.get('GITHUB_TOKEN')).toBe('changed-token');
    expect(changed.has('GITLAB_TOKEN')).toBe(false);
  });

  it('trims values and treats an empty value as absent', async () => {
    writeFileSync(envFile, 'GITHUB_TOKEN=  spaced-token  \nGITLAB_TOKEN=   \n');
    reloadForgeTokens();

    const tokens = await readForgeTokens(envFile);
    expect(tokens.get('GITHUB_TOKEN')).toBe('spaced-token');
    expect(tokens.has('GITLAB_TOKEN')).toBe(false);
  });
});
