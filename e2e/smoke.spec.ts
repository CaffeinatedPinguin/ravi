/**
 * Smoke tests for the built app in Microsoft Edge: the start page, a local review with an inline
 * draft that survives a reload, and the settings page. Each test also writes light/dark screenshots
 * for the orchestrator (REVU_E2E_SCREENS, default `.e2e-out/screens`).
 */
import { expect, test } from '@playwright/test';
import { startApp } from './support/app.ts';
import type { AppServer } from './support/app.ts';
import { startFakeForge } from './support/fake-forge.ts';
import type { FakeForge } from './support/fake-forge.ts';
import { createFixture } from './support/fixture.ts';
import type { Fixture } from './support/fixture.ts';
import { shot } from './support/screenshots.ts';

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

test.beforeEach(async ({ page }) => {
  // Opening the CLI's URL sets the session cookie and connects the fixture folder.
  await page.goto(app.url);
  await expect(page.getByRole('navigation', { name: 'Changed files' })).toBeVisible();
});

test('start page lists the fixture repository', async ({ page }) => {
  await page.goto(`${app.baseUrl}/`);
  await expect(page.getByRole('heading', { name: 'revu', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: /sample-repo/ })).toBeVisible();
  await shot(page, app.baseUrl, 'home');
});

test('local review shows the diff and keeps an inline draft across reload', async ({ page }) => {
  const tree = page.getByRole('navigation', { name: 'Changed files' });
  await expect(tree).toContainText('app.ts');
  await expect(tree).toContainText('new-name.ts');
  await expect(page.locator('[aria-label="Diff"]')).toContainText('greet');

  // The first gutter button belongs to the first rendered line of the first changed file.
  await page.getByRole('button', { name: /^Comment on line \d+$/ }).first().click();
  const body = 'E2E draft: please cover this with a test';
  await page.getByRole('textbox', { name: 'Comment text' }).fill(body);
  const saved = page.waitForResponse((response) => response.url().endsWith('/api/reviews/save') && response.ok());
  await page.getByRole('button', { name: 'Add comment', exact: true }).click();
  await saved;

  await expect(page.getByText(body)).toBeVisible();
  await expect(page.getByText('Pending', { exact: true })).toBeVisible();
  // A draft must stay local; only the explicit Send action may reach the forge.
  expect(forge.writes).toEqual([]);
  await page.reload();
  await expect(page.getByText(body)).toBeVisible();
  await shot(page, app.baseUrl, 'review-comment');
});

test('settings page renders the notification filters', async ({ page }) => {
  await page.goto(`${app.baseUrl}/settings`);
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible();
  await expect(page.getByText('Mute bot authors')).toBeVisible();
  await shot(page, app.baseUrl, 'settings');
});
