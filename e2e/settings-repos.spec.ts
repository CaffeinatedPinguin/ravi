/**
 * Settings → Repositories and Accounts in the built app.
 *
 * The native folder dialog cannot run in a headless browser; the server replaces it with the path
 * in REVU_E2E_PICK_FOLDER when REVU_E2E=1. `startApp` passes the parent environment on, so setting
 * the variable here is enough.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
let pickedRepo = '';
let pastedRepo = '';

test.beforeAll(async () => {
  fixture = createFixture();
  pickedRepo = makeRepository(join(fixture.root, 'picked-repo'));
  pastedRepo = makeRepository(join(fixture.root, 'pasted-repo'));
  process.env.REVU_E2E_PICK_FOLDER = pickedRepo;
  forge = await startFakeForge();
  app = await startApp(fixture, forge.url);
});

test.afterAll(async () => {
  delete process.env.REVU_E2E_PICK_FOLDER;
  await app.stop();
  await forge.stop();
  fixture.cleanup();
});

test.beforeEach(async ({ page }) => {
  // Opening the CLI's URL sets the session cookie.
  await page.goto(app.url);
  await page.goto(`${app.baseUrl}/settings`);
  await expect(page.getByRole('heading', { name: 'Repositories', exact: true })).toBeVisible();
});

test('adds a local folder through Choose folder and requires a transport', async ({ page }) => {
  await openWizard(page);
  await shot(page, app.baseUrl, 'settings-repos-add');

  await openWizard(page);
  await page.getByRole('button', { name: 'Choose folder' }).click();
  const wizard = page.getByRole('region', { name: 'Add repository' });
  await expect(wizard.getByText(pickedRepo)).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();

  // Uploading the connection step's screenshot reloads the page, so this is verified first.
  await expect(page.getByRole('radio', { name: /use my SSH keys/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled();
  await shot(page, app.baseUrl, 'settings-repos-connection');

  await openWizard(page);
  await page.getByRole('button', { name: 'Choose folder' }).click();
  await expect(wizard.getByText(pickedRepo)).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('radio', { name: /use my SSH keys/ }).check();
  await expect(page.getByRole('button', { name: 'Continue' })).toBeEnabled();
  await page.getByRole('button', { name: 'Continue' }).click();

  await wizard.getByRole('button', { name: 'Test connection', exact: true }).click();
  await expect(wizard.getByRole('status')).toContainText('Git:');
  await wizard.getByRole('button', { name: 'Save', exact: true }).click();

  await expect(wizard).toHaveCount(0);
  await expect(page.getByText('picked-repo', { exact: true })).toBeVisible();
  // Adding a repository must never write to the forge.
  expect(forge.writes).toEqual([]);
});

test('adds a local folder through Paste path', async ({ page }) => {
  await openWizard(page);
  await page.getByLabel('Paste path').check();
  await page.getByLabel('Folder path').fill(pastedRepo);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('radio', { name: /HTTPS — use a token/ }).check();
  await page.getByRole('button', { name: 'Continue' }).click();

  const wizard = page.getByRole('region', { name: 'Add repository' });
  await wizard.getByRole('button', { name: 'Save', exact: true }).click();

  await expect(wizard).toHaveCount(0);
  await expect(page.getByText('pasted-repo', { exact: true })).toBeVisible();
});

test('saves a host token and shows only the masked hint', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Accounts', exact: true })).toBeVisible();
  await page.getByRole('heading', { name: 'Accounts', exact: true }).scrollIntoViewIfNeeded();
  await shot(page, app.baseUrl, 'settings-accounts');

  const input = page.locator('input[aria-label="Token for github.com"]');
  await input.fill('e2e-token-1234');
  await page.getByRole('button', { name: 'Save token for github.com' }).click();

  await expect(page.getByText('••••1234')).toBeVisible();
  await expect(page.getByText('e2e-token-1234')).toHaveCount(0);
  expect(forge.writes).toEqual([]);
});

async function openWizard(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Add repository' }).click();
  await expect(page.getByRole('region', { name: 'Add repository' })).toBeVisible();
}

/** A minimal git repository; the connection test only needs a working tree. */
function makeRepository(path: string): string {
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'README.md'), '# fixture\n');
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: path });
  return path;
}
