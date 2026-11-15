import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { RefsSchema } from '../../shared/api.ts';
import type { Repo } from '../../shared/api.ts';
import { createRouter } from '../app.ts';
import { handleRequest } from '../http/server.ts';
import { resolvePaths } from '../paths.ts';
import { writeJsonFile } from '../store/json-file.ts';
import { readRefs } from './refs.ts';

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

/** Git with a fixed identity, no hooks and no line-ending rewriting, whatever the host config says. */
function git(cwd: string, args: string[], env: NodeJS.ProcessEnv = {}): string {
  return execFileSync(
    'git',
    [
      '-c', 'user.name=ravi test',
      '-c', 'user.email=ravi@example.com',
      '-c', 'commit.gpgsign=false',
      '-c', 'core.autocrlf=false',
      ...args,
    ],
    { cwd, encoding: 'utf8', env: { ...process.env, ...env } },
  );
}

/** One commit with an explicit date, so newest-first ordering cannot depend on the wall clock. */
function commit(cwd: string, message: string, date: string): string {
  writeFileSync(join(cwd, 'a.txt'), `${message}\n`, { flag: 'a' });
  git(cwd, ['add', '.']);
  git(cwd, ['commit', '--no-verify', '-q', '-m', message], { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
  return git(cwd, ['rev-parse', 'HEAD']).trim();
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
  const paths = resolvePaths({ RAVI_HOME: temp('refs-home') });
  const repo: Repo = {
    id: REPO_ID,
    path,
    name: 'work',
    lastUsedAt: '2026-11-15T10:00:00.000Z',
    kind: 'local',
    remote: null,
  };
  await writeJsonFile(join(paths.data, 'repos.json'), [repo]);
  return paths;
}

describe('refs route', () => {
  it('returns every group with the right names, commits and tags newest first', async () => {
    const work = temp('refs');
    git(work, ['init', '-q', '-b', 'main']);
    const first = commit(work, 'first', '2026-01-01T10:00:00Z');
    const second = commit(work, 'second', '2026-01-02T10:00:00Z');
    const third = commit(work, 'third', '2026-01-03T10:00:00Z');
    // A second local branch, one remote-tracking ref plus the origin/HEAD alias that must vanish.
    git(work, ['branch', 'topic', first]);
    git(work, ['update-ref', 'refs/remotes/origin/topic', second]);
    git(work, ['update-ref', 'refs/remotes/origin/HEAD', third]);
    // Annotated tags carry a tagger date; lightweight ones fall back to the commit date.
    git(work, ['tag', 'light', first]);
    git(work, ['tag', '-a', 'annotated', '-m', 'annotated', second], { GIT_COMMITTER_DATE: '2026-01-05T10:00:00Z' });

    const refs = await readRefs(work);
    expect(refs.branches).toEqual(['main', 'topic']);
    expect(refs.remoteBranches).toEqual(['origin/topic']);
    expect(refs.tags).toEqual(['annotated', 'light']);
    expect(refs.commits.map((entry) => entry.sha)).toEqual([third, second, first]);
    expect(refs.commits.map((entry) => entry.subject)).toEqual(['third', 'second', 'first']);
    expect(refs.commits[0]?.shortSha).toBe(git(work, ['rev-parse', '--short', 'HEAD']).trim());
    expect(refs.commits[0]?.date).toMatch(/^2026-01-03T10:00:00/);

    const answer = await getJson(await connect(work), `/api/repos/${REPO_ID}/refs`);
    expect(answer.status).toBe(200);
    expect(RefsSchema.parse(JSON.parse(answer.body))).toEqual(refs);
  });

  it('returns an empty tag list when the repository has no tags', async () => {
    const work = temp('refs-no-tags');
    git(work, ['init', '-q', '-b', 'main']);
    commit(work, 'only commit', '2026-02-01T10:00:00Z');

    const refs = await readRefs(work);

    expect(refs.tags).toEqual([]);
    expect(refs.branches).toEqual(['main']);
    expect(refs.remoteBranches).toEqual([]);
    expect(refs.commits).toHaveLength(1);
  });
});
