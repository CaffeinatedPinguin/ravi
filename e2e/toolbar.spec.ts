/**
 * Toolbar cleanup proof: the Markdown transfer actions are one Export menu (no separate Import,
 * Copy or Save buttons), the refresh time moved from its own text into the save-status tooltip and
 * the reload label, and the status follows the review store. Screenshots are live because the open
 * menu and the transient "Saving…" state would not survive the reload used by `shot()`.
 */
import { expect, test } from '@playwright/test';
import { shotLive } from './flows/support.ts';
import { startApp } from './support/app.ts';
import type { AppServer } from './support/app.ts';
import { startFakeForge } from './support/fake-forge.ts';
import type { FakeForge } from './support/fake-forge.ts';
import { createFixture } from './support/fixture.ts';
import type { Fixture } from './support/fixture.ts';

const BODY = 'Toolbar export proof: please cover this with a test';

let fixture: Fixture;
let forge: FakeForge;
let app: AppServer;

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

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
  // The CLI's `open` parameter connects the fixture folder and lands on its review.
  await page.goto(app.url);
  await expect(page.getByRole('navigation', { name: 'Changed files' })).toBeVisible();
});

test('Export menu holds Copy and Save, Import is its own button, Shift+C works and the save status shows', async ({ page }) => {
  // Import is a button of its own; Copy and Save live in the Export menu; no "Updated …" label.
  await expect(page.getByRole('button', { name: 'Import', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
  await expect(page.getByText(/^Updated (just now|\d+ s ago|\d+ min ago)$/)).toHaveCount(0);

  const exportButton = page.getByRole('button', { name: 'Export', exact: true });
  await expect(exportButton).toBeVisible();
  await exportButton.click();
  const menu = page.getByRole('menu', { name: 'Export' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem')).toHaveCount(2);
  await expect(menu.getByRole('menuitem')).toHaveText(['Copy for AI', 'Save as file']);
  await shotLive(page, 'toolbar-export-menu');

  // Escape and an outside click both close the menu without choosing anything.
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await exportButton.click();
  await expect(menu).toBeVisible();
  await page.getByRole('button', { name: /^Notes/ }).click();
  await expect(menu).toHaveCount(0);
  await page.getByRole('button', { name: 'Close review notes' }).click();

  // A draft edit starts the debounced save: "Saving…" first, then "Saved" once the server answered.
  await page.getByRole('button', { name: /^Comment on line \d+$/ }).first().click();
  await page.getByRole('textbox', { name: 'Comment text' }).fill(BODY);
  const saveStatus = page.locator('[data-save-status]');
  await page.getByRole('button', { name: 'Add comment', exact: true }).click();
  await expect(saveStatus).toHaveText('Saving…');
  await expect(saveStatus).toHaveText('Saved', { timeout: 10_000 });
  await expect(saveStatus).toHaveAttribute('title', /^Last refreshed /);
  await expect(page.getByRole('button', { name: /^Reload changes, last refreshed / })).toBeVisible();
  await shotLive(page, 'toolbar-status');

  // "Save as file" still downloads the same `*.review.md` name.
  await exportButton.click();
  const download = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Save as file', exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/\.review\.md$/);

  // The Shift+C shortcut still copies the exported Markdown.
  await exportButton.focus();
  await page.keyboard.press('Shift+C');
  await expect(page.getByRole('status').filter({ hasText: 'Copied 1 comment for AI' })).toBeVisible();
  const markdown = await page.evaluate<string>('navigator.clipboard.readText()');
  expect(markdown).toContain('# Code review: local');
  expect(markdown).toContain(BODY);

  // Drafts stay local; nothing here may write to the forge.
  expect(forge.writes).toEqual([]);
});
