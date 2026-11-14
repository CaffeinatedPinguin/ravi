/** Routes that expose a diff: file list, patches for a batch of files, file content for expanding context. */
import { BlobRequestSchema, DiffOptionsSchema, PatchesRequestSchema } from '../../shared/api.ts';
import type { Blob } from '../../shared/api.ts';
import type { AppContext } from '../app.ts';
import { diffPatches, diffSummary, readBlobLines } from '../git/diff.ts';
import type { Router } from '../http/router.ts';
import { getRepo } from '../store/repos.ts';

export function registerDiffRoutes(router: Router, { paths }: AppContext): void {
  const repoRoot = async (id: string | undefined) => (await getRepo(paths, id ?? '')).path;

  // POST although they only read: the diff target is structured and file lists can be long.
  router.post('/api/repos/:id/diff', async ({ params, body }) => diffSummary(await repoRoot(params.id), await body(DiffOptionsSchema)));

  router.post('/api/repos/:id/diff/patches', async ({ params, body }) =>
    diffPatches(await repoRoot(params.id), await body(PatchesRequestSchema)),
  );

  router.post('/api/repos/:id/blob', async ({ params, body }): Promise<Blob> => {
    const request = await body(BlobRequestSchema);
    return { lines: await readBlobLines(await repoRoot(params.id), request.target, request.side, request.path) };
  });
}
