/**
 * Regression: the dashboard's "Refresh all" promises to reload the repositories *and* the Review
 * later list. Only the repository cards were covered by the other specs, so this one asserts the
 * second half: one click sends `POST /api/review-later/refresh`.
 */
import { expect, test } from '@playwright/test';
import { startApp } from './support/app.ts';
import type { AppServer } from './support/app.ts';
import { startFakeForge } from './support/fake-forge.ts';
import type { FakeForge } from './support/fake-forge.ts';
import { createFixture } from './support/fixture.ts';
import type { Fixture } from './support/fixture.ts';

let fixture: Fixture;
let forge: FakeForge;
let app: AppServer;

test.beforeAll(async () => {
  fixture = createFixture();
  forge = await startFakeForge();
  app = await startApp(fixture, forge.url);
});

test.afterAll(async () => {
  await app.stop();
  await forge.stop();
  fixture.cleanup();
});

test('Refresh all also refreshes the Review later list', async ({ page }) => {
  // The CLI URL sets the session cookie and connects the fixture; wait for that connection,
  // because the dashboard shows the setup screen while no repository is known yet.
  await page.goto(app.url);
  await expect(page.getByRole('navigation', { name: 'Changed files' })).toBeVisible();
  await page.goto(`${app.baseUrl}/`);

  const refresh = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith('/api/review-later/refresh'),
  );
  await page.getByRole('button', { name: 'Refresh all', exact: true }).click();

  const request = await refresh;
  expect(request.method()).toBe('POST');
  expect(new URL(request.url()).pathname).toBe('/api/review-later/refresh');
});
