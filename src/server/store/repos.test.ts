import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { resolvePaths } from '../paths.ts';
import { writeJsonFile } from './json-file.ts';
import { listRepos } from './repos.ts';

const home = mkdtempSync(join(tmpdir(), 'revu-repos-store-'));
const paths = resolvePaths({ REVU_HOME: home });

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
});

describe('listRepos', () => {
  it('reads a repos.json written before remote clones existed as local folders', async () => {
    await writeJsonFile(join(paths.data, 'repos.json'), [
      { id: 'a1b2c3d4e5f6', path: '/tmp/example', name: 'example', lastUsedAt: '2026-11-14T10:00:00.000Z' },
    ]);

    const [repo] = await listRepos(paths);

    expect(repo).toMatchObject({ kind: 'local', remote: null, transport: 'https', tokenScope: 'repo' });
  });
});
