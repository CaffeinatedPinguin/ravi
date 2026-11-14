/** Routes for connecting local folders and reading repository facts. */
import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { AddRepoRequestSchema, ScanRequestSchema } from '../../shared/api.ts';
import type { DirList } from '../../shared/api.ts';
import type { AppContext } from '../app.ts';
import { readRepoInfo } from '../git/repo.ts';
import type { Router } from '../http/router.ts';
import { addRepo, getRepo, listRepos, removeRepo, scanForRepos } from '../store/repos.ts';

export function registerRepoRoutes(router: Router, { paths }: AppContext): void {
  router.get('/api/repos', () => listRepos(paths));

  router.post('/api/repos', async ({ body }) => addRepo(paths, (await body(AddRepoRequestSchema)).path));

  router.delete('/api/repos/:id', ({ params }) => removeRepo(paths, params.id ?? ''));

  router.post('/api/repos/scan', async ({ body }) => scanForRepos(resolve((await body(ScanRequestSchema)).path)));

  router.get('/api/repos/:id/info', async ({ params }) => readRepoInfo((await getRepo(paths, params.id ?? '')).path));

  // Feeds the folder picker: a browser cannot hand a real file system path to the server.
  router.get('/api/fs/dirs', async ({ query }): Promise<DirList> => {
    const path = resolve(query.get('path') || homedir());
    const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
    const dirs = entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && !entry.name.startsWith('$'))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));
    return { path, dirs };
  });
}
