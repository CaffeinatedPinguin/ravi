/** Composition root of the HTTP API: every feature registers its routes here. */
import packageJson from '../../package.json' with { type: 'json' };
import { SettingsSchema } from '../shared/api.ts';
import type { Health } from '../shared/api.ts';
import { registerDiffRoutes } from './api/diff.ts';
import { registerForgeRoutes } from './api/forges.ts';
import { registerRepoRoutes } from './api/repos.ts';
import { registerReviewRoutes } from './api/review.ts';
import { Router } from './http/router.ts';
import type { Paths } from './paths.ts';
import { readSettings, writeSettings } from './store/settings.ts';

export const VERSION: string = packageJson.version;

export type AppContext = {
  paths: Paths;
};

export function createRouter(context: AppContext): Router {
  const router = new Router();
  router.get('/api/health', (): Health => ({ app: 'revu', version: VERSION }));
  router.get('/api/settings', () => readSettings(context.paths));
  router.put('/api/settings', async ({ body }) => writeSettings(context.paths, await body(SettingsSchema)));
  registerRepoRoutes(router, context);
  registerForgeRoutes(router, context);
  registerDiffRoutes(router, context);
  registerReviewRoutes(router, context);
  return router;
}
