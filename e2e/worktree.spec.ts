/**
 * Linked worktree proof: the Worktree selector appears only when the repository has more than one
 * worktree, and picking one reviews everything that folder holds beyond the default base.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
let worktreePath: string;

test.beforeAll(async () => {
  fixture = createFixture();
  // An agent-style worktree inside the fixture root, on its own branch, with one edit and one new file.
  worktreePath = join(fixture.root, 'agent-worktree');
  git(fixture.repoPath, ['worktree', 'add', '-q', '-b', 'agent-topic', worktreePath]);
  writeFileSync(
    join(worktreePath, 'src/util.ts'),
    'export function sum(values: number[]): number {\n  return values.reduce((total, value) => total + value, 0);\n}\n',
  );
  writeFileSync(join(worktreePath, 'src/agent-new.ts'), 'export const fromAgent = true;\n');
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

test('the Worktree selector reviews a linked folder with its committed, uncommitted and untracked files', async ({ page }) => {
  // A staged comparison cannot list untracked files, so the toggle there proves the mode really changed.
  await page.getByLabel('What to review').selectOption('staged');
  await expect(page.getByRole('checkbox', { name: 'Untracked files' })).toHaveCount(0);

  const picker = page.getByRole('combobox', { name: 'Worktree' });
  await expect(picker).toBeVisible();
  await picker.click();
  await expect(picker).toHaveAttribute('aria-expanded', 'true');
  const list = page.getByRole('listbox', { name: 'Worktree' });
  await expect(list.getByRole('option')).toHaveCount(2);
  await expect(list.getByRole('option', { name: /\(this folder\)/ })).toBeVisible();

  const loaded = page.waitForResponse(
    (response) =>
      response.url().endsWith('/diff') &&
      response.request().method() === 'POST' &&
      response.ok() &&
      (response.request().postData() ?? '').includes('agent-worktree'),
  );
  await list.getByRole('option', { name: /agent-topic/ }).click();
  await loaded;

  // A linked worktree always starts "All changes against" the default base, carrying its path in `w`.
  await expect(page).toHaveURL(/[?&]t=all%3Amain/);
  await expect(page).toHaveURL(/[?&]w=/);
  await expect(picker).toHaveValue('agent-topic');

  const tree = page.getByRole('navigation', { name: 'Changed files' });
  await expect(tree.getByText('agent-new.ts')).toBeVisible();
  await expect(tree.getByText('util.ts')).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Untracked files' })).toBeChecked();
  await shotLive(page, 'worktree-review');

  // Nothing in this flow may reach the forge.
  expect(forge.writes).toEqual([]);
});
