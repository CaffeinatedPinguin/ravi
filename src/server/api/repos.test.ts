import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { RepoInfoSchema, WorktreeListSchema } from '../../shared/api.ts';
import type { Repo } from '../../shared/api.ts';
import { createRouter } from '../app.ts';
import { handleRequest } from '../http/server.ts';
import { resolvePaths } from '../paths.ts';
import { writeJsonFile } from '../store/json-file.ts';

const REPO_ID = 'a1b2c3d4';
const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function temp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `ravi-${prefix}-`));
  tempDirs.push(dir);
  return dir;
}

/** Git with a fixed identity and no hooks, so the host configuration cannot interfere. */
function git(cwd: string, args: string[]): string {
  return execFileSync(
    'git',
    [
      '-c', 'user.name=ravi test',
      '-c', 'user.email=ravi@example.com',
      '-c', 'commit.gpgsign=false',
      '-c', 'core.autocrlf=false',
      ...args,
    ],
    { cwd, encoding: 'utf8' },
  );
}

type Captured = { status: number; body: string };

/** The request path goes through the whole router, so a missing registration would be a 404. */
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

async function connect(path: string): Promise<ReturnType<typeof resolvePaths>> {
  const paths = resolvePaths({ RAVI_HOME: temp('repos-home') });
  const repo: Repo = {
    id: REPO_ID,
    path,
    name: 'work',
    lastUsedAt: '2026-11-17T10:00:00.000Z',
    kind: 'local',
    remote: null,
  };
  await writeJsonFile(join(paths.data, 'repos.json'), [repo]);
  return paths;
}

describe('worktrees routes', () => {
  it('lists worktrees, answers info for a listed one and 404 for an unknown path', async () => {
    const repo = temp('worktrees-api');
    git(repo, ['init', '-q', '-b', 'main']);
    writeFileSync(join(repo, 'a.txt'), 'one\n');
    git(repo, ['add', '.']);
    git(repo, ['commit', '--no-verify', '-q', '-m', 'initial']);
    const linked = join(temp('worktrees-api-linked'), 'wt');
    git(repo, ['worktree', 'add', '-q', '-b', 'topic', linked]);
    const paths = await connect(repo);

    const list = await getJson(paths, `/api/repos/${REPO_ID}/worktrees`);
    expect(list.status).toBe(200);
    const worktrees = WorktreeListSchema.parse(JSON.parse(list.body));
    expect(worktrees).toHaveLength(2);
    expect(worktrees[0]).toMatchObject({ main: true, current: true, branch: 'main' });
    const linkedEntry = worktrees.find((worktree) => worktree.branch === 'topic');
    expect(linkedEntry).toBeDefined();

    const info = await getJson(paths, `/api/repos/${REPO_ID}/info?worktree=${encodeURIComponent(linkedEntry?.path ?? '')}`);
    expect(info.status).toBe(200);
    expect(RepoInfoSchema.parse(JSON.parse(info.body)).branch).toBe('topic');

    const unknown = await getJson(
      paths,
      `/api/repos/${REPO_ID}/info?worktree=${encodeURIComponent(join(tmpdir(), 'ravi-nowhere'))}`,
    );
    expect(unknown.status).toBe(404);
  });
});
