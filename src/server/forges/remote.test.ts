import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { detectRepoRef, parseRemoteUrl } from './remote.ts';

const repo = mkdtempSync(join(tmpdir(), 'revu-forge-remote-'));

function git(args: string[]): void {
  execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
}

beforeAll(() => {
  git(['init', '-q']);
});

afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('parseRemoteUrl', () => {
  it('parses the supported HTTPS, SCP and SSH forms', () => {
    expect(parseRemoteUrl('https://github.com/acme/api.git')).toEqual({ host: 'github.com', project: 'acme/api' });
    expect(parseRemoteUrl('https://github.com/acme/api')).toEqual({ host: 'github.com', project: 'acme/api' });
    expect(parseRemoteUrl('git@github.com:acme/api.git')).toEqual({ host: 'github.com', project: 'acme/api' });
    expect(parseRemoteUrl('ssh://git@github.com:22/acme/api.git')).toEqual({ host: 'github.com', project: 'acme/api' });
  });

  it('keeps nested GitLab groups in the project path', () => {
    expect(parseRemoteUrl('https://gitlab.com/group/sub/project.git')).toEqual({
      host: 'gitlab.com',
      project: 'group/sub/project',
    });
    expect(parseRemoteUrl('git@gitlab.com:group/sub/project.git')).toEqual({
      host: 'gitlab.com',
      project: 'group/sub/project',
    });
  });

  it('returns null for anything that is not a repository URL', () => {
    expect(parseRemoteUrl('https://github.com/acme')).toBeNull();
    expect(parseRemoteUrl('file:///home/acme/api')).toBeNull();
    expect(parseRemoteUrl('/home/acme/api')).toBeNull();
    expect(parseRemoteUrl('git://github.com/acme/api.git')).toBeNull();
    expect(parseRemoteUrl('')).toBeNull();
  });
});

describe('detectRepoRef', () => {
  it('returns the ref for a registered host and null for a foreign host', async () => {
    git(['remote', 'add', 'origin', 'https://github.com/acme/api.git']);
    expect(await detectRepoRef(repo)).toEqual({ host: 'github.com', project: 'acme/api' });

    git(['remote', 'set-url', 'origin', 'https://evil.com/acme/api.git']);
    expect(await detectRepoRef(repo)).toBeNull();

    git(['remote', 'set-url', 'origin', 'git@gitlab.com:group/sub/project.git']);
    expect(await detectRepoRef(repo)).toEqual({ host: 'gitlab.com', project: 'group/sub/project' });
  });

  it('returns null when the repository has no origin', async () => {
    git(['remote', 'remove', 'origin']);
    expect(await detectRepoRef(repo)).toBeNull();
  });
});
