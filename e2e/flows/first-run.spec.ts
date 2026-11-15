/**
 * First run: an empty data folder teaches the new user the two things revu needs (a repository and
 * a connection choice) and ends on a dashboard that lists the connected folder.
 */
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { startApp } from '../support/app.ts';
import type { AppServer } from '../support/app.ts';
import { startFakeForge } from '../support/fake-forge.ts';
import type { FakeForge } from '../support/fake-forge.ts';
import { shot } from '../support/screenshots.ts';
import { emptyHomeFixture, makeRepository, openSession, shotLive } from './support.ts';
import type { Fixture } from '../support/fixture.ts';

let fixture: Fixture;
let forge: FakeForge;
let app: AppServer;
let pickedRepo = '';
const REPO_NAME = 'first-run-repo';

test.beforeAll(async () => {
  fixture = emptyHomeFixture();
  pickedRepo = makeRepository(join(fixture.root, REPO_NAME));
  // The native folder dialog cannot run headless; the server substitutes this path in E2E mode.
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
  await openSession(page, app);
  await page.goto(`${app.baseUrl}/`);
});

test('empty data folder: setup screen, add repository, dashboard', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Add your first repository' })).toBeVisible();
  await shot(page, app.baseUrl, 'flow-first-run-setup');

  await page.getByRole('button', { name: 'Add your first repository' }).click();
  await expect(page.getByRole('heading', { name: 'Repositories', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Add repository' }).click();
  const wizard = page.getByRole('region', { name: 'Add repository' });
  await expect(wizard).toBeVisible();
  await wizard.getByRole('button', { name: 'Choose folder' }).click();
  await expect(wizard.getByText(pickedRepo)).toBeVisible();
  await wizard.getByRole('button', { name: 'Continue' }).click();

  // The connection step is a required decision; the wizard blocks it by disabling Continue.
  await expect(wizard.getByText('Connection (required)')).toBeVisible();
  const continueButton = wizard.getByRole('button', { name: 'Continue' });
  await expect(continueButton).toBeDisabled();
  await expect(wizard.getByText('Connection (required)')).toBeVisible();
  const repoList = (await (await page.request.get(`${app.baseUrl}/api/repos`)).json()) as unknown[];
  expect(repoList).toEqual([]);
  await shotLive(page, 'flow-first-run-connection');

  await wizard.getByRole('radio', { name: /SSH — use my SSH keys/ }).check();
  await expect(continueButton).toBeEnabled();
  await continueButton.click();

  await expect(wizard.getByRole('button', { name: 'Test connection', exact: true })).toBeVisible();
  await wizard.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(wizard).toHaveCount(0);

  await page.goto(`${app.baseUrl}/`);
  await expect(page.getByRole('link', { name: REPO_NAME, exact: true })).toBeVisible();
  await shotLive(page, 'flow-first-run-dashboard');
});
