/**
 * A pull request on the fake forge: the dashboard entry, an inline forge thread, one local draft
 * sent with a COMMENT verdict, and then an empty APPROVE. Every write the app makes is inspected
 * on the fake forge, so "nothing happens until Send" and "exactly one review" are asserted.
 */
import { expect, test } from '@playwright/test';
import { startApp } from '../support/app.ts';
import type { AppServer } from '../support/app.ts';
import { startExtraFakeForge } from '../support/fake-forge-extra.ts';
import type { ExtendedFakeForge } from '../support/fake-forge-extra.ts';
import { createPullRequestFixture, routeOriginToLocalBare, shotLive } from './support.ts';
import type { PullRequestFixture } from './support.ts';

let fixture: PullRequestFixture;
let forge: ExtendedFakeForge;
let app: AppServer;

const DRAFT_BODY = 'PR draft: tighten the helper before merging';
const REVIEW_PATH = '/repos/e2e/sample/pulls/1/reviews';

test.beforeAll(async () => {
  fixture = createPullRequestFixture();
  forge = await startExtraFakeForge({
    pull: {
      author: 'alice',
      title: 'E2E pull request',
      baseSha: fixture.baseSha,
      headSha: fixture.headSha,
      requested: true,
    },
    comments: [
      {
        id: 500,
        author: 'alice',
        body: 'Please rename this helper.',
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
  // The CLI's `open` parameter connects the folder and detects github.com from `origin`.
  await page.goto(app.url);
  await expect(page.getByRole('combobox', { name: 'Repository' })).toBeVisible();
  // Redirect the git transport to a local bare repository; the forge remote stays github.com.
  routeOriginToLocalBare(fixture.repoPath, fixture.barePath);
  await page.goto(`${app.baseUrl}/`);
});

test('review a pull request: inline thread, comment send, then approve', async ({ page }) => {
  await expect(page.getByRole('heading', { name: /Waiting for my review/ })).toBeVisible();
  const pull = page.getByRole('button', { name: /E2E pull request/ });
  await expect(pull).toBeVisible();
  await pull.click();

  await expect(page.getByRole('heading', { name: /E2E pull request/ })).toBeVisible();
  const remoteThread = page.getByRole('article', { name: 'Remote thread' });
  await expect(remoteThread).toBeVisible();
  await expect(remoteThread.getByText('Please rename this helper.')).toBeVisible();
  await shotLive(page, 'flow-pr-files');

  // A new-side inline comment on a context line with no forge thread of its own.
  await page.getByRole('button', { name: 'Comment on line 1' }).click();
  await page.getByRole('textbox', { name: 'Comment text' }).fill(DRAFT_BODY);
  const saved = page.waitForResponse(
    (response) => response.url().endsWith('/api/reviews/save') && response.ok(),
  );
  await page.getByRole('button', { name: 'Add comment', exact: true }).click();
  await saved;
  const localThread = page.getByRole('region', { name: 'Comments on line 1' });
  await expect(localThread).toBeVisible();
  await expect(localThread.getByText(DRAFT_BODY).first()).toBeVisible();

  // Send menu → Comment opens the confirmation, which lists exactly the draft that will leave.
  await page.getByRole('button', { name: 'Choose the review verdict' }).click();
  await page.getByRole('menuitem', { name: 'Comment', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Send review' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/1 draft: 1 comment, 0 replies, 0 edits, 0 deletions/)).toBeVisible();
  const drafts = dialog.getByRole('list', { name: 'Drafts that will be sent' });
  await expect(drafts).toContainText('src/util.ts:1');
  await expect(drafts).toContainText(DRAFT_BODY);
  await shotLive(page, 'flow-pr-confirm');

  const sent = page.waitForResponse(
    (response) => response.url().includes('/pulls/1/send') && response.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Send to github.com' }).click();
  await sent;
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Comments on line 1' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Send (0)' })).toBeDisabled();

  const afterComment = reviewPosts(forge);
  expect(afterComment).toHaveLength(1);
  const first = afterComment[0];
  if (first === undefined) {
    throw new Error('The comment review was not recorded');
  }
  const commentBody = JSON.parse(first.body) as Record<string, unknown>;
  expect(commentBody.event).toBe('COMMENT');
  const comments = commentBody.comments;
  expect(Array.isArray(comments)).toBe(true);
  if (!Array.isArray(comments) || comments.length !== 1) {
    throw new Error('The review did not carry exactly one comment');
  }
  const comment = comments[0] as Record<string, unknown>;
  expect(comment.path).toBe('src/util.ts');
  expect(comment.line).toBe(1);
  expect(comment.side).toBe('RIGHT');
  expect(comment.body).toBe(DRAFT_BODY);

  // Approve with no drafts: one more review, APPROVE only, and the header reports it.
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  const approveDialog = page.getByRole('dialog', { name: 'Send review' });
  await expect(approveDialog).toBeVisible();
  await expect(approveDialog.getByText(/0 drafts/)).toBeVisible();
  await expect(approveDialog.getByRole('list', { name: 'Drafts that will be sent' })).toHaveCount(0);
  const approved = page.waitForResponse(
    (response) => response.url().includes('/pulls/1/send') && response.request().method() === 'POST',
  );
  await approveDialog.getByRole('button', { name: 'Send to github.com' }).click();
  await approved;
  await expect(approveDialog).toHaveCount(0);
  await expect(page.getByText('Approved by you')).toBeVisible();
  await shotLive(page, 'flow-pr-approved');

  const afterApprove = reviewPosts(forge);
  expect(afterApprove).toHaveLength(2);
  const second = afterApprove[1];
  if (second === undefined) {
    throw new Error('The approve review was not recorded');
  }
  const approveBody = JSON.parse(second.body) as Record<string, unknown>;
  expect(approveBody.event).toBe('APPROVE');
  expect(approveBody.comments).toBeUndefined();
});

function reviewPosts(target: ExtendedFakeForge): Array<{ method: string; path: string; body: string }> {
  return target.writes.filter((write) => write.method === 'POST' && write.path.endsWith(REVIEW_PATH));
}
