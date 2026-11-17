/**
 * The dashboard hint for a forge host without a token: the repository row has no separate "Settings"
 * link; the hint sentence itself links to the Accounts section and that section is scrolled into view.
 *
 * The fixture home is seeded with a token by default, so it is emptied first to reach the missing-token
 * state; the remote is added exactly like `dashboard.spec.ts`.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
  execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/e2e/sample.git'], { cwd: fixture.repoPath });
  // No token for github.com means the dashboard shows the hint instead of pull requests.
  writeFileSync(join(fixture.home, '.env'), '');
  forge = await startFakeForge();
  app = await startApp(fixture, forge.url);
});

test.afterAll(async () => {
  await app.stop();
  await forge.stop();
  fixture.cleanup();
});

test('the token hint links to the Accounts section', async ({ page }) => {
  // Opening the CLI URL sets the session cookie and connects the fixture folder.
  await page.goto(app.url);
  await expect(page.getByRole('navigation', { name: 'Changed files' })).toBeVisible();
  // A short viewport keeps the assertion honest: the Accounts heading starts below the fold.
  await page.setViewportSize({ width: 1440, height: 300 });
  await page.goto(`${app.baseUrl}/`);

  const repo = page.getByRole('region', { name: 'sample-repo' });
  await expect(repo.getByText('github.com · token missing')).toBeVisible();

  // The header link is gone; the only settings link in the row is the hint itself.
  await expect(repo.getByRole('link', { name: 'Settings', exact: true })).toHaveCount(0);
  await expect(repo.getByRole('link', { name: /Settings/ })).toHaveCount(1);

  const hint = repo.getByRole('link', { name: 'Add a token in Settings', exact: true });
  await expect(hint).toHaveAttribute('href', '/settings#settings-accounts');
  await hint.click();

  await expect(page).toHaveURL(`${app.baseUrl}/settings#settings-accounts`);
  await expect(page.getByRole('heading', { name: 'Accounts', exact: true })).toBeInViewport();
});
