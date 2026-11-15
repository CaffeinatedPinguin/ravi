import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { Repo } from '../../shared/api.ts';
import { createRouter } from '../app.ts';
import { handleRequest } from '../http/server.ts';
import { resolvePaths } from '../paths.ts';
import { writeJsonFile } from '../store/json-file.ts';
import { repoSummary } from './summary.ts';

const REPO_ID = 'a1b2c3d4';
const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function temp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `revu-${prefix}-`));
  tempDirs.push(dir);
  return dir;
}

/** Git with a fixed identity, no hooks and no line-ending rewriting, whatever the host config says. */
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

async function connect(repo: Repo): Promise<ReturnType<typeof resolvePaths>> {
  const home = temp('summary-home');
  const paths = resolvePaths({ REVU_HOME: home });
  await writeJsonFile(join(paths.data, 'repos.json'), [repo]);
  return paths;
}

function repo(path: string, kind: Repo['kind'] = 'local'): Repo {
  return {
    id: REPO_ID,
    path,
    name: 'work',
    lastUsedAt: '2026-11-15T10:00:00.000Z',
    kind,
    remote: kind === 'remote' ? { host: 'github.com', project: 'acme/api' } : null,
  };
}

type Captured = { status: number; body: string };

/** The request path is exercised through the whole router, so a missing registration would be a 404. */
async function getJson(paths: ReturnType<typeof resolvePaths>, path: string): Promise<Captured> {
  let status = 0;
  let body: Buffer = Buffer.alloc(0);
  const req = { url: path, method: 'GET', headers: { host: '127.0.0.1:4783' } } as unknown as IncomingMessage;
  const res = {
    headersSent: false,
    writeHead(nextStatus: number) {
      status = nextStatus;
    },
    end(chunk?: Buffer | string) {
      if (chunk !== undefined) {
        body = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      }
    },
  } as unknown as ServerResponse;
  await handleRequest(req, res, {
    router: createRouter({ paths }),
    security: { token: 'test-token', allowedHosts: ['127.0.0.1:4783'], skipSession: true },
    assets: null,
  });
  return { status, body: body.toString('utf8') };
}

describe('repository summary route', () => {
  it('answers through createRouter with the repository summary instead of a 404', async () => {
    const work = temp('summary-route');
    git(work, ['init', '-q', '-b', 'main']);
    writeFileSync(join(work, 'a.txt'), 'one\n');
    git(work, ['add', '.']);
    git(work, ['commit', '--no-verify', '-q', '-m', 'only commit']);

    const answer = await getJson(await connect(repo(work)), `/api/repos/${REPO_ID}/summary`);

    expect(answer.status).toBe(200);
    expect(JSON.parse(answer.body)).toMatchObject({
      branch: 'main',
      uncommitted: { files: 0 },
      lastCommit: { subject: 'only commit' },
    });
  });
});

describe('repository summary', () => {
  it('reports the upstream distance, uncommitted counts with untracked files and the last commit', async () => {
    const root = temp('summary-upstream');
    const origin = join(root, 'origin.git');
    const work = join(root, 'work');
    mkdirSync(work);
    git(root, ['init', '--bare', '-q', origin]);
    git(work, ['init', '-q', '-b', 'main']);
    writeFileSync(join(work, 'a.txt'), 'one\n');
    git(work, ['add', '.']);
    git(work, ['commit', '--no-verify', '-q', '-m', 'base']);
    git(work, ['remote', 'add', 'origin', origin]);
    git(work, ['push', '-q', '-u', 'origin', 'main']);

    writeFileSync(join(work, 'a.txt'), 'one\ntwo\n');
    git(work, ['add', '.']);
    git(work, ['commit', '--no-verify', '-q', '-m', 'local commit']);
    const localSha = git(work, ['rev-parse', 'HEAD']).trim();

    // A second clone pushes one more commit, so the local branch is one ahead and one behind.
    const other = join(root, 'other');
    git(root, ['clone', '-q', origin, other]);
    writeFileSync(join(other, 'other.txt'), 'remote\n');
    git(other, ['add', '.']);
    git(other, ['commit', '--no-verify', '-q', '-m', 'remote commit']);
    git(other, ['push', '-q', 'origin', 'main']);
    git(work, ['fetch', '-q', 'origin']);

    // One tracked line and one untracked file are still in the working tree.
    writeFileSync(join(work, 'a.txt'), 'one\ntwo\nthree\n');
    writeFileSync(join(work, 'untracked.txt'), 'u1\nu2\n');

    const summary = await repoSummary(await connect(repo(work)), REPO_ID);

    expect(summary).toMatchObject({
      branch: 'main',
      ahead: 1,
      behind: 1,
      uncommitted: { files: 2, additions: 3, deletions: 0, untracked: 1 },
      lastCommit: { sha: localSha, subject: 'local commit' },
    });
    expect(summary.lastCommit?.date).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('leaves ahead and behind null when the branch has no upstream', async () => {
    const work = temp('summary-no-upstream');
    git(work, ['init', '-q', '-b', 'main']);
    writeFileSync(join(work, 'a.txt'), 'one\n');
    git(work, ['add', '.']);
    git(work, ['commit', '--no-verify', '-q', '-m', 'only commit']);

    const summary = await repoSummary(await connect(repo(work)), REPO_ID);

    expect(summary).toMatchObject({
      branch: 'main',
      ahead: null,
      behind: null,
      uncommitted: { files: 0, additions: 0, deletions: 0, untracked: 0 },
      lastCommit: { subject: 'only commit' },
    });
  });

  it('returns null local-only fields for a remote clone but still reads its last commit', async () => {
    const root = temp('summary-remote');
    const origin = join(root, 'origin.git');
    const source = join(root, 'source');
    git(root, ['init', '--bare', '-q', origin]);
    git(root, ['init', '-q', '-b', 'main', source]);
    git(source, ['remote', 'add', 'origin', origin]);
    writeFileSync(join(source, 'a.txt'), 'one\n');
    git(source, ['add', '.']);
    git(source, ['commit', '--no-verify', '-q', '-m', 'remote head']);
    git(source, ['push', '-q', '-u', 'origin', 'main']);
    const sha = git(source, ['rev-parse', 'HEAD']).trim();

    const summary = await repoSummary(await connect(repo(origin, 'remote')), REPO_ID);

    expect(summary).toMatchObject({
      branch: null,
      ahead: null,
      behind: null,
      uncommitted: null,
      lastCommit: { sha, subject: 'remote head' },
    });
  });
});
