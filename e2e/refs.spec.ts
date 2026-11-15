/**
 * Ref picker proof: the base branch becomes a searchable list that selects with the keyboard and
 * reloads the review, and the repository switcher is a combobox too. Screenshots are live (no
 * reload) because an open dropdown is transient state that `shot()` would destroy.
 */
import { expect, test } from '@playwright/test';
import { git, shotLive } from './flows/support.ts';
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
  // A second branch one commit behind HEAD: `main` stays the default base (alphabetical order) and
  // the branch comparison has a real diff to load after the selection.
  git(fixture.repoPath, ['branch', 'ref-picker', 'HEAD~1']);
  git(fixture.repoPath, ['tag', 'v1', 'HEAD~1']);
  forge = await startFakeForge();
  app = await startApp(fixture, forge.url);
});

test.afterAll(async () => {
  await app.stop();
  await forge.stop();
  fixture.cleanup();
});

test.beforeEach(async ({ page }) => {
  // The CLI's `open` parameter connects the fixture folder and lands on its review.
  await page.goto(app.url);
  await expect(page.getByRole('navigation', { name: 'Changed files' })).toBeVisible();
});

test('base branch filters, selects with ArrowDown + Enter and the repository switcher is a list', async ({ page }) => {
  await page.getByLabel('What to review').selectOption('branch');

  const base = page.getByRole('combobox', { name: 'Base branch' });
  await expect(base).toHaveValue('main');
  await base.click();
  await expect(base).toHaveAttribute('aria-expanded', 'true');

  const baseList = page.getByRole('listbox', { name: 'Base branch' });
  await expect(baseList.getByRole('option')).toHaveCount(2);
  await shotLive(page, 'ref-picker-open');

  await base.fill('REF');
  await expect(baseList.getByRole('option')).toHaveCount(1);
  await expect(baseList.getByRole('option', { name: 'ref-picker' })).toBeVisible();
  await expect(baseList.getByRole('option', { name: 'main' })).toHaveCount(0);
  await shotLive(page, 'ref-picker-search');

  const reloaded = page.waitForResponse(
    (response) =>
      response.url().endsWith('/diff') &&
      response.request().method() === 'POST' &&
      response.ok() &&
      (response.request().postData() ?? '').includes('ref-picker'),
  );
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await reloaded;

  await expect(base).toHaveAttribute('aria-expanded', 'false');
  await expect(base).toHaveValue('ref-picker');
  await expect(page).toHaveURL(/[?&]t=branch%3Aref-picker/);

  const repository = page.getByRole('combobox', { name: 'Repository' });
  await expect(repository).toHaveValue('sample-repo');
  await repository.click();
  await expect(repository).toHaveAttribute('aria-expanded', 'true');
  const repoList = page.getByRole('listbox', { name: 'Repository' });
  await expect(repoList.getByRole('option', { name: 'sample-repo' })).toBeVisible();
  await shotLive(page, 'repo-switcher');

  await page.keyboard.press('Escape');
  await expect(repository).toHaveAttribute('aria-expanded', 'false');
  await expect(repository).toHaveValue('sample-repo');

  // Nothing in this flow may reach the forge.
  expect(forge.writes).toEqual([]);
});
