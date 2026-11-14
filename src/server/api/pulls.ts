/** Routes for pull requests and the "review later" list. */
import { ReviewLaterAddRequestSchema } from '../../shared/api.ts';
import type { AppContext } from '../app.ts';
import { resolveCommit } from '../git/repo.ts';
import { HttpError } from '../http/router.ts';
import type { Router } from '../http/router.ts';
import { defaultForgeLookup, pullRequestNumber, requireRemote } from '../pulls/lookup.ts';
import { fileUrlTemplateFor, openPullRequest } from '../pulls/open.ts';
import { listPullRequests, pullRequestStatus, pullRequestThreads } from '../pulls/query.ts';
import type { ListPullRequestsOptions } from '../pulls/query.ts';
import { addReviewLater, listReviewLater, refreshReviewLater, removeReviewLater } from '../pulls/review-later.ts';
import { getRepo } from '../store/repos.ts';

export function registerPullRoutes(router: Router, { paths }: AppContext): void {
  router.get('/api/repos/:id/pulls', async ({ params, query }) =>
    listPullRequests(paths, params.id ?? '', listOptions(query)),
  );

  // POST although it mostly reads: opening runs `git fetch` for a head named by request input.
  router.post('/api/repos/:id/pulls/:number/open', async ({ params }) =>
    openPullRequest(paths, params.id ?? '', pullRequestNumber(params.number)),
  );

  router.get('/api/repos/:id/pulls/:number/threads', async ({ params }) =>
    pullRequestThreads(paths, params.id ?? '', pullRequestNumber(params.number)),
  );

  router.get('/api/repos/:id/pulls/:number/status', async ({ params }) =>
    pullRequestStatus(paths, params.id ?? '', pullRequestNumber(params.number)),
  );

  // Local reviews can offer forge links too, but they have no pull request to open; the UI asks
  // for the template of the commit it is looking at. Same shape as the `open` response.
  router.get('/api/repos/:id/file-url-template', async ({ params, query }) => {
    const sha = query.get('sha') ?? '';
    // A ref or commit id; reject anything that could be read as a git option.
    if (!/^[0-9a-zA-Z][0-9a-zA-Z._/-]{0,199}$/.test(sha)) {
      throw new HttpError(400, 'sha must be a commit or ref name');
    }
    const repo = await getRepo(paths, params.id ?? '');
    const remote = requireRemote(repo);
    const forge = await defaultForgeLookup(paths)(repo);
    const resolved = await resolveCommit(repo.path, sha);
    const template = fileUrlTemplateFor(forge, remote, resolved);
    return { fileUrlTemplate: template, oldFileUrlTemplate: template };
  });

  router.get('/api/review-later', () => listReviewLater(paths));

  router.post('/api/review-later', async ({ body }) =>
    addReviewLater(paths, await body(ReviewLaterAddRequestSchema)),
  );

  router.delete('/api/review-later/:repoId/:number', async ({ params }) => {
    await removeReviewLater(paths, params.repoId ?? '', pullRequestNumber(params.number));
  });

  router.post('/api/review-later/refresh', () => refreshReviewLater(paths));
}

function listOptions(query: URLSearchParams): ListPullRequestsOptions {
  const state = query.get('state') ?? 'open';
  if (state !== 'open' && state !== 'all') {
    throw new HttpError(400, 'state must be open or all');
  }
  const mine = query.get('mine') ?? '0';
  if (mine !== '0' && mine !== '1') {
    throw new HttpError(400, 'mine must be 0 or 1');
  }
  return { state, mine: mine === '1' };
}
