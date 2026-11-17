/**
 * Notifications: filter settings with a live preview, two new forge comments (one from a muted
 * author), "Check now", the bell badge and the inbox link that lands on the diff thread.
 */
import { expect, test } from '@playwright/test';
import type { Page, Response } from '@playwright/test';
import { startApp } from '../support/app.ts';
import type { AppServer } from '../support/app.ts';
import { startExtraFakeForge } from '../support/fake-forge-extra.ts';
import type { ExtendedFakeForge } from '../support/fake-forge-extra.ts';
import { shot } from '../support/screenshots.ts';
import { createPullRequestFixture, routeOriginToLocalBare, shotLive } from './support.ts';
import type { PullRequestFixture } from './support.ts';

let fixture: PullRequestFixture;
let forge: ExtendedFakeForge;
let app: AppServer;

test.beforeAll(async () => {
  fixture = createPullRequestFixture();
  forge = await startExtraFakeForge({
    pull: {
      author: 'e2e-user',
      title: 'E2E pull request',
      baseSha: fixture.baseSha,
      headSha: fixture.headSha,
      requested: false,
    },
    comments: [
      {
        id: 500,
        author: 'alice',
        body: 'Please-review the sum helper.',
        path: 'src/util.ts',
        line: 2,
        side: 'RIGHT',
        createdAt: '2026-11-14T10:00:00Z',
      },
    ],
  });
  app = await startApp(fixture, forge.url);
});

test.afterAll(async () => {
  await app.stop();
  await forge.stop();
  fixture.cleanup();
});

test.beforeEach(async ({ page }) => {
  await page.goto(app.url);
  await expect(page.getByRole('combobox', { name: 'Repository' })).toBeVisible();
  routeOriginToLocalBare(fixture.repoPath, fixture.barePath);
});

test('notification filters, one unread from a new comment, inbox lands on the thread', async ({ page }) => {
  // First pass is the baseline: existing comments are remembered but notify nobody.
  await checkNow(page, /No notifications yet/);
  await expect(page.getByRole('button', { name: 'Notifications, 0 unread' })).toBeVisible();

  await page.goto(`${app.baseUrl}/settings`);
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();

  const muted = page.getByRole('textbox', { name: 'Add to Muted authors' });
  await muted.fill('noise');
  const mutedSaved = page.waitForResponse(isSettingsSave);
  await muted.press('Enter');
  await mutedSaved;
  await expect(page.getByRole('list', { name: 'Muted authors' })).toContainText('noise');

  const include = page.getByRole('textbox', { name: 'Add to Include text' });
  await include.fill('please-review');
  const includeSaved = page.waitForResponse(isSettingsSave);
  await include.press('Enter');
  await includeSaved;
  await expect(page.getByText('Would notify 1 of the last 1 comments.')).toBeVisible();
  await shotLive(page, 'flow-notify-settings');

  // The forge gains two comments; only the one from a non-muted author passes the filters.
  forge.addComment({
    author: 'noise',
    body: 'please-review the generated noise',
    path: 'src/util.ts',
    line: 2,
    createdAt: '2026-11-15T12:00:00Z',
  });
  const notifying = forge.addComment({
    author: 'alice',
    body: 'please-review the sum change',
    path: 'src/util.ts',
    line: 2,
    createdAt: '2026-11-15T12:01:00Z',
  });

  await page.getByRole('button', { name: /^Notifications,/ }).click();
  const panel = page.getByRole('dialog', { name: 'Notifications' });
  await expect(panel).toBeVisible();
  const polled = page.waitForResponse(
    (response) => response.url().endsWith('/api/notifications/poll') && response.request().method() === 'POST',
  );
  await panel.getByRole('button', { name: 'Check now' }).click();
  await polled;
  await expect(page.getByRole('button', { name: 'Notifications, 1 unread' })).toBeVisible();
  await expect(panel.getByText('1 unread')).toBeVisible();
  await page.keyboard.press('Escape');

  await page.goto(`${app.baseUrl}/inbox`);
  await expect(page.getByRole('heading', { name: 'Inbox' })).toBeVisible();
  await expect(page.getByText('1 unread')).toBeVisible();
  await shot(page, app.baseUrl, 'flow-notify-inbox');

  const item = page.getByRole('button', { name: /please-review the sum change/ });
  await expect(item).toBeVisible();
  await item.click();
  await expect(page.getByRole('heading', { name: /E2E pull request/ })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('thread')).toBe(String(notifying.id));
  // Three forge comments (500, 5000 and the new one) anchor on src/util.ts line 2, so the page must
  // show exactly three thread sections: one per distinct forge thread, not one per sibling row.
  await expect(page.locator('[id^="thread-"]')).toHaveCount(3);
  await expect(page.locator(`#thread-${String(notifying.id)}`)).toHaveCount(1);
  await expect(page.locator(`#thread-${String(notifying.id)}`)).toBeVisible();
});

/** Opens the bell, runs one poll and waits for the panel to settle. */
async function checkNow(page: Page, settled: RegExp): Promise<void> {
  await page.getByRole('button', { name: /^Notifications,/ }).click();
  const panel = page.getByRole('dialog', { name: 'Notifications' });
  await expect(panel).toBeVisible();
  const polled = page.waitForResponse(
    (response) => response.url().endsWith('/api/notifications/poll') && response.request().method() === 'POST',
  );
  await panel.getByRole('button', { name: 'Check now' }).click();
  await polled;
  await expect(panel.getByText(settled)).toBeVisible();
  await page.keyboard.press('Escape');
}

function isSettingsSave(response: Response): boolean {
  return response.url().endsWith('/api/settings') && response.request().method() === 'PUT';
}
