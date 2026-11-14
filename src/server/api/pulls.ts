/** Routes for pull requests and the "review later" list. */
import { ReviewLaterAddRequestSchema } from '../../shared/api.ts';
import type { AppContext } from '../app.ts';
import { HttpError } from '../http/router.ts';
import type { Router } from '../http/router.ts';
import { pullRequestNumber } from '../pulls/lookup.ts';
import { openPullRequest } from '../pulls/open.ts';
import { listPullRequests, pullRequestStatus, pullRequestThreads } from '../pulls/query.ts';
import type { ListPullRequestsOptions } from '../pulls/query.ts';
import { addReviewLater, listReviewLater, refreshReviewLater, removeReviewLater } from '../pulls/review-later.ts';

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
