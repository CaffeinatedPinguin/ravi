/**
 * Fixes wave proof: the Settings page shares the top bar, and an inline thread is measured exactly
 * so the next code line starts where the thread ends (no stale ~40px estimate).
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
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

/**
 * The virtualized row wrapper is the measured element: its bottom must meet the next row's top.
 * The thread's inner padding is irrelevant here, which is exactly what the stale estimate broke.
 */
async function expectThreadGap(page: Page): Promise<void> {
  const thread = page.locator('section[aria-label^="Comments on line"]').first();
  await expect(thread).toBeVisible();
  const row = thread.locator('xpath=ancestor::div[@data-index][1]');
  const index = Number(await row.getAttribute('data-index'));
  const next = page.locator(`[data-index="${index + 1}"]`);
  await expect(next).toBeVisible();

  await expect
    .poll(async () => {
      const threadBox = await row.boundingBox();
      const nextBox = await next.boundingBox();
      if (threadBox === null || nextBox === null) {
        return Number.POSITIVE_INFINITY;
      }
      return Math.abs(nextBox.y - (threadBox.y + threadBox.height));
    })
    .toBeLessThanOrEqual(2);
}

test('an inline thread is followed directly by the next code line', async ({ page }) => {
  await page.goto(app.url);
  await expect(page.getByRole('navigation', { name: 'Changed files' })).toBeVisible();

  await page.getByRole('button', { name: /^Comment on line \d+$/ }).first().click();
  await page.getByRole('textbox', { name: 'Comment text' }).fill('Gap probe');
  const saved = page.waitForResponse((response) => response.url().endsWith('/api/reviews/save') && response.ok());
  await page.getByRole('button', { name: 'Add comment', exact: true }).click();
  await saved;

  await expect(page.getByText('Gap probe')).toBeVisible();
  await expectThreadGap(page);
  await shot(page, app.baseUrl, 'review-thread-gap');
  // The screenshot reloads the page for each theme, so prove the measured row survived that too.
  await expectThreadGap(page);
});

test('the Settings page uses the shared brand and top bar actions', async ({ page }) => {
  await page.goto(app.url);
  await page.goto(`${app.baseUrl}/settings`);

  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'revu by smrodek.xyz' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Notifications/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible();

  await shot(page, app.baseUrl, 'settings-topbar');
});
