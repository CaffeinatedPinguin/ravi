/**
 * Regression: importing an *unchanged* export must skip every comment.
 *
 * A reply section carries the same quoted code fence as its root, but the importer parses replies
 * as plain bodies, so the fence ends up in the reply text and an untouched export is reported as
 * edited. The flow is kept as a fixme until the server side is fixed (see .task/report.md).
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { startApp } from '../support/app.ts';
import { startFakeForge } from '../support/fake-forge.ts';
import { createFixture } from '../support/fixture.ts';

const ROOT_BODY = 'Import round trip root';
const REPLY_BODY = 'Import round trip reply';

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

test.fixme(
  "APP BUG: an unchanged reply is edited on import because its exported code fence is parsed into its body",
  async ({ page }) => {
    const fixture = createFixture();
    const forge = await startFakeForge();
    const app = await startApp(fixture, forge.url);
    try {
      await page.goto(app.url);
      await expect(page.getByRole('navigation', { name: 'Changed files' })).toBeVisible();
      await focusOnlyLongFile(page);

      // One root comment and one reply, each exported with its quoted code context.
      await page.getByRole('button', { name: 'Comment on line 4', exact: true }).last().click();
      await page.getByRole('textbox', { name: 'Comment text' }).fill(ROOT_BODY);
      await page.getByRole('button', { name: 'Add comment', exact: true }).click();
      const thread = page.getByRole('region', { name: 'Comments on line 4' });
      await expect(thread).toBeVisible();
      await thread.getByRole('button', { name: 'Reply' }).click();
      await page.getByRole('textbox', { name: 'Comment text' }).fill(REPLY_BODY);
      await page.keyboard.press('Control+Enter');
      await expect(thread.getByText(REPLY_BODY)).toBeVisible();

      await page.getByRole('group', { name: 'Review Markdown' }).getByRole('button', { name: 'Copy' }).click();
      await expect(page.getByRole('status').filter({ hasText: 'Copied 2 comments for AI' })).toBeVisible();
      const markdown = await page.evaluate<string>('navigator.clipboard.readText()');

      await page.getByRole('group', { name: 'Review Markdown' }).getByRole('button', { name: 'Import' }).click();
      await page.getByRole('textbox', { name: 'Review Markdown to import' }).fill(markdown);
      await page.getByRole('button', { name: 'Preview' }).click();
      // The bug shows "0 added · 1 edited · 1 skipped": only the reply is wrongly changed.
      await expect(page.getByText('0 added · 0 edited · 2 skipped')).toBeVisible();
      await page.getByRole('button', { name: 'Apply' }).click();
      await expect(thread.getByText(REPLY_BODY, { exact: true })).toBeVisible();
    } finally {
      await app.stop();
      await forge.stop();
      fixture.cleanup();
    }
  },
);

/** Collapses every file, then expands only `src/long.ts` so line 4 has one unambiguous gutter. */
async function focusOnlyLongFile(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Collapse all files' }).click();
  const headerPath = page.locator('button[title^="Copy "][title$="/src/long.ts"]').first();
  await expect(headerPath).toBeVisible();
  const header = headerPath.locator('..');
  await header.getByRole('button', { name: 'Expand file' }).click();
  await expect(page.locator('[aria-label="Diff"]')).toContainText('changed(4)');
}
