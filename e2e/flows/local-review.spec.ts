/**
 * Local review: split view with expanded context, a Shift+click range comment, reply, edit,
 * delete/undo, and the Markdown Copy → edit → Import round trip. The clipboard is read through the
 * real Clipboard API (the test context grants the permission), so the exported text is asserted,
 * not just the toast.
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { startApp } from '../support/app.ts';
import type { AppServer } from '../support/app.ts';
import { startFakeForge } from '../support/fake-forge.ts';
import type { FakeForge } from '../support/fake-forge.ts';
import { createFixture } from '../support/fixture.ts';
import type { Fixture } from '../support/fixture.ts';
import { shotLive } from './support.ts';

let fixture: Fixture;
let forge: FakeForge;
let app: AppServer;

const ROOT_BODY = 'Range draft: the helper needs a test';
const EDITED_BODY = 'Range draft: the helper needs a test and a changelog';
const REPLY_BODY = 'Reply: I will add the test in this branch';
const IMPORTED_BODY = 'Edited by the imported review';
const IMPORTED_REPLY_BODY = 'Reply updated by the import dialog';

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

test('split view, range comment lifecycle and Markdown round trip', async ({ page }) => {
  await switchLayout(page, 'Split');
  await focusOnlyLongFile(page);

  // Expanding the whole file pulls real content through /blob, not just a taller placeholder.
  await expect(page.locator('[aria-label="Diff"]')).toContainText('export const line8 = 8;');
  await shotLive(page, 'flow-local-split');

  // Click `+` on the fourth line, then Shift+click `+` on the fifth: the composer extends into a
  // range on the same (new) side. `exact` is essential: the virtualized diff renders many gutter
  // buttons, and a substring match would pick `Comment on line 49` instead of line 4.
  const lineFour = page.getByRole('button', { name: 'Comment on line 4', exact: true }).last();
  await lineFour.click();
  await expect(page.getByRole('textbox', { name: 'Comment text' })).toBeVisible();
  await page.getByRole('button', { name: 'Comment on line 5', exact: true }).last().click({ modifiers: ['Shift'] });
  const submit = page.getByRole('button', { name: /^Comment on lines 4–5$/ });
  await expect(submit).toBeVisible();
  await page.getByRole('textbox', { name: 'Comment text' }).fill(ROOT_BODY);
  await submit.click();
  await expect(page.getByText(ROOT_BODY)).toBeVisible();

  const thread = page.getByRole('region', { name: 'Comments on line 4-5' });
  await expect(thread).toBeVisible();
  await expect(page.getByText('Pending', { exact: true }).first()).toBeVisible();

  // Reply. The open composer adds a second "Reply" button (its submit), so Ctrl+Enter submits it
  // through the documented keyboard path instead of relying on an ambiguous role lookup.
  await thread.getByRole('button', { name: 'Reply' }).click();
  await page.getByRole('textbox', { name: 'Comment text' }).fill(REPLY_BODY);
  await page.keyboard.press('Control+Enter');
  await expect(thread.getByText(REPLY_BODY)).toBeVisible();

  // Edit the root.
  await thread.getByRole('button', { name: 'Edit' }).first().click();
  const editor = page.getByRole('textbox', { name: 'Comment text' });
  await expect(editor).toHaveValue(ROOT_BODY);
  await editor.fill(EDITED_BODY);
  await thread.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(thread.getByText(EDITED_BODY)).toBeVisible();

  // Delete the root and its reply, then restore both from the toast.
  await thread.getByRole('button', { name: 'Delete' }).first().click();
  await expect(thread).toHaveCount(0);
  const toast = page.getByRole('status').filter({ hasText: 'Comment deleted' });
  await expect(toast).toBeVisible();
  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('region', { name: 'Comments on line 4-5' })).toBeVisible();
  await expect(page.getByText(EDITED_BODY)).toBeVisible();
  await expect(page.getByText(REPLY_BODY)).toBeVisible();

  // Copy exports Markdown with the self-describing header and `path:line` sections.
  await page.bringToFront();
  await page.getByRole('group', { name: 'Review Markdown' }).getByRole('button', { name: 'Copy' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Copied 2 comments for AI' })).toBeVisible();
  const markdown = await page.evaluate<string>('navigator.clipboard.readText()');
  expect(markdown).toContain('# Code review: local');
  expect(markdown).toContain('revu-review v1');
  expect(markdown).toContain('src/long.ts:4-5 (new)');
  expect(markdown).toContain(EDITED_BODY);
  expect(markdown).toContain(REPLY_BODY);

  // Import an edited copy of the exported text. Both bodies differ from the document, so the report
  // has to count two edits; the unchanged-reply round trip has its own regression spec (and a known
  // app bug: the reply's exported code fence leaks into its body — see .task/report.md).
  const importedText = markdown
    .split(EDITED_BODY)
    .join(IMPORTED_BODY)
    .split(REPLY_BODY)
    .join(IMPORTED_REPLY_BODY);
  await page.getByRole('group', { name: 'Review Markdown' }).getByRole('button', { name: 'Import' }).click();
  const dialog = page.getByRole('dialog', { name: 'Import review' });
  await expect(dialog).toBeVisible();
  await page.getByRole('textbox', { name: 'Review Markdown to import' }).fill(importedText);
  await page.getByRole('button', { name: 'Preview' }).click();
  await expect(page.getByText('0 added · 2 edited · 0 skipped')).toBeVisible();
  await shotLive(page, 'flow-local-import-report');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(IMPORTED_BODY)).toBeVisible();
  await expect(page.getByText(IMPORTED_REPLY_BODY)).toBeVisible();

  // A draft must stay local; only an explicit Send may reach the forge.
  expect(forge.writes).toEqual([]);
});

async function switchLayout(page: Page, name: 'Split' | 'Unified'): Promise<void> {
  const saved = page.waitForResponse(
    (response) => response.url().endsWith('/api/settings') && response.request().method() === 'PUT',
  );
  await page.getByRole('radio', { name }).click();
  await saved;
}

/**
 * Collapses every file, then expands only `src/long.ts` and its full content. Other files cannot
 * contribute a same-numbered gutter button, so the Shift+click target is unambiguous.
 */
async function focusOnlyLongFile(page: Page): Promise<void> {
  const diff = page.locator('[aria-label="Diff"]');
  await page.getByRole('button', { name: 'Collapse all files' }).click();
  const headerPath = page.locator('button[title^="Copy "][title$="/src/long.ts"]').first();
  await expect(headerPath).toBeVisible();
  const header = headerPath.locator('..');
  await header.getByRole('button', { name: 'Expand file' }).click();
  await expect(diff).toContainText('changed(4)');
  await header.getByRole('button', { name: 'Show full file' }).click();
}
