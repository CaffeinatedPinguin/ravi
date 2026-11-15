import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { reloadForgeTokens, readForgeTokens } from './env.ts';
import { setEnvVar } from './env-write.ts';

const home = mkdtempSync(join(tmpdir(), 'revu-env-write-'));
const file = join(home, '.env');
const original = [
  '# revu tokens',
  'GITHUB_TOKEN=old-github',
  '',
  'GITLAB_TOKEN=old-gitlab # keep this comment',
  '# trailing comment',
  '',
].join('\n');

const read = (): string => readFileSync(file, 'utf8');

beforeEach(() => {
  reloadForgeTokens();
  writeFileSync(file, original);
});

afterAll(() => {
  reloadForgeTokens();
  rmSync(home, { recursive: true, force: true });
});

describe('setEnvVar', () => {
  it('appends a new variable and keeps every other line byte-for-byte', async () => {
    await setEnvVar(file, 'REVU_TOKEN_A1B2', 'repo-token-1');

    expect(read()).toBe(`${original}REVU_TOKEN_A1B2=repo-token-1\n`);
    expect(parseEnv(read()).REVU_TOKEN_A1B2).toBe('repo-token-1');
  });

  it('replaces an existing value in place and leaves comments and order untouched', async () => {
    await setEnvVar(file, 'GITHUB_TOKEN', 'new-github');

    const lines = read().split('\n');
    expect(lines[0]).toBe('# revu tokens');
    expect(lines[1]).toBe('GITHUB_TOKEN=new-github');
    expect(lines[2]).toBe('');
    expect(lines[3]).toBe('GITLAB_TOKEN=old-gitlab # keep this comment');
    expect(lines[4]).toBe('# trailing comment');
  });

  it('removes the variable and nothing else', async () => {
    await setEnvVar(file, 'GITHUB_TOKEN', null);

    expect(read()).toBe(['# revu tokens', '', 'GITLAB_TOKEN=old-gitlab # keep this comment', '# trailing comment', ''].join('\n'));
  });

  it('removes a variable that is not there without touching the file', async () => {
    await setEnvVar(file, 'GITLAB_TOKEN', null);
    const afterRemoval = read();
    await setEnvVar(file, 'REVU_TOKEN_MISSING', null);

    expect(read()).toBe(afterRemoval);
  });

  it('quotes a value with spaces and a hash, and parseEnv reads it back', async () => {
    const value = 'tok en#1';
    await setEnvVar(file, 'GITLAB_TOKEN', value);

    expect(read()).toContain(`GITLAB_TOKEN="${value}"`);
    expect(parseEnv(read()).GITLAB_TOKEN).toBe(value);
  });

  it('rejects a value with a newline without changing the file or echoing the value', async () => {
    const value = 'first-line\nsecond-line';
    const error = await setEnvVar(file, 'REVU_TOKEN_A1B2', value).then(
      () => null,
      (reason: unknown) => reason,
    );

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain(value);
    expect((error as Error).message).not.toContain('second-line');
    expect(read()).toBe(original);
  });

  it('rejects an invalid variable name and never repeats a token', async () => {
    const error = await setEnvVar(file, 'bad-name', 'tok-value-1234').then(
      () => null,
      (reason: unknown) => reason,
    );

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain('tok-value-1234');
    expect(read()).toBe(original);
  });

  it('writes the file with mode 0600 on POSIX', async () => {
    await setEnvVar(file, 'REVU_TOKEN_A1B2', 'repo-token-1');
    if (process.platform !== 'win32') {
      expect(statSync(file).mode & 0o777).toBe(0o600);
    }
  });

  it('makes the new token visible through readForgeTokens immediately', async () => {
    expect((await readForgeTokens(file)).get('GITHUB_TOKEN')).toBe('old-github');
    await setEnvVar(file, 'GITHUB_TOKEN', 'fresh-token');

    expect((await readForgeTokens(file)).get('GITHUB_TOKEN')).toBe('fresh-token');
  });

  it('keeps CRLF line endings of an existing file', async () => {
    writeFileSync(file, 'A_TOKEN=one\r\nB_TOKEN=two\r\n');

    await setEnvVar(file, 'B_TOKEN', 'three');

    expect(read()).toBe('A_TOKEN=one\r\nB_TOKEN=three\r\n');
  });
});
