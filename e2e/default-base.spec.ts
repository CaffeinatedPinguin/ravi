/**
 * Settings → Review "Default base branch": it seeds the Base branch list, and picking it never
 * changes which working-tree comparison is open.
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { shotLive } from './flows/support.ts';
import { startApp } from './support/app.ts';
import type { AppServer } from './support/app.ts';
import { startFakeForge } from './support/fake-forge.ts';
import type { FakeForge } from './support/fake-forge.ts';
import { createFixture } from './support/fixture.ts';
import type { Fixture } from './support/fixture.ts';

// This host's Edge spends ~20 s per fresh context on proxy auto-detection, which alone exceeds
// the gate's whole e2e budget. Pin a proxy that is never used (the app is loopback and bypasses it).
test.use({ proxy: { server: 'http://127.0.0.1:9', bypass: '127.0.0.1,localhost' } });

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
  await page.goto(app.url);
  // The top bar renders before the diff; the base check below waits for `/info` instead.
  await expect(page.getByLabel('What to review')).toBeVisible();
});

test('default base branch seeds a branch comparison and working-tree targets stay available', async ({ page }) => {
  // The review still opens on the working tree.
  const kind = page.getByLabel('What to review');
  await expect(kind).toHaveValue('uncommitted');
  await expect(kind.locator('option')).toHaveCount(5);
  for (const [value, label] of [
    ['uncommitted', 'Uncommitted changes'],
    ['unstaged', 'Unstaged changes'],
    ['staged', 'Staged changes'],
  ] as const) {
    await expect(kind.locator(`option[value="${value}"]`)).toHaveText(label);
  }

  // All three working-tree comparisons keep their kind in the URL.
  for (const value of ['unstaged', 'staged', 'uncommitted'] as const) {
    await kind.selectOption(value);
    await expect(kind).toHaveValue(value);
    await expect(page).toHaveURL(new RegExp(`[?&]t=${value}(?:&|$)`));
  }

  await openSettings(page);
  await chooseDefaultBase(page, 'main');
  await expect(page.getByRole('combobox', { name: 'Default base branch' })).toHaveValue('main');
  await shotLive(page, 'settings-default-base');

  await backToReview(page);
  // Picking a default base must not move the review away from the working tree.
  const afterSetting = page.getByLabel('What to review');
  await expect(afterSetting).toHaveValue('uncommitted');
  await afterSetting.selectOption('branch');
  await expect(page.getByRole('combobox', { name: 'Base branch' })).toHaveValue('main');

  // Automatic returns to the repository's own detection.
  await afterSetting.selectOption('uncommitted');
  await openSettings(page);
  await chooseDefaultBase(page, 'Automatic');
  await backToReview(page);
  await page.getByLabel('What to review').selectOption('branch');
  await expect(page.getByRole('combobox', { name: 'Base branch' })).toHaveValue('main');

  // Nothing in this flow may reach the forge.
  expect(forge.writes).toEqual([]);
});

async function openSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Review', exact: true })).toBeVisible();
}

async function backToReview(page: Page): Promise<void> {
  // Navigating is local; wait for the info request that seeds the base branch instead of `networkidle`.
  const info = page.waitForResponse(
    (response) => /\/api\/repos\/[^/]+\/info$/.test(response.url()) && response.ok(),
  );
  await page.goBack();
  await info;
  await expect(page.getByLabel('What to review')).toBeVisible();
}

async function chooseDefaultBase(page: Page, name: 'main' | 'Automatic'): Promise<void> {
  const combo = page.getByRole('combobox', { name: 'Default base branch' });
  const saved = page.waitForResponse(
    (response) => response.url().endsWith('/api/settings') && response.request().method() === 'PUT' && response.ok(),
  );
  await combo.click();
  await page.getByRole('listbox', { name: 'Default base branch' }).getByRole('option', { name, exact: true }).click();
  await saved;
  await expect(combo).toHaveValue(name);
}
