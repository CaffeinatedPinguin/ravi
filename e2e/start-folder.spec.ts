/**
 * `ravi <folder>` where the folder is not a repository itself.
 *
 * The start screen must stay calm: repositories found inside are offered in a dialog, and a folder
 * with none gets a short toast instead of a permanent red error.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { startApp } from './support/app.ts';
import type { AppServer } from './support/app.ts';
import { startFakeForge } from './support/fake-forge.ts';
import type { FakeForge } from './support/fake-forge.ts';
import { removeTree } from './support/fixture.ts';
import type { Fixture } from './support/fixture.ts';

type StartFixture = Fixture & {
  /** Not a repository, but holds `found-one` and `found-two`. */
  scanRoot: string;
  /** Not a repository and empty. */
  emptyFolder: string;
};

let scanFixture: StartFixture;
let emptyFixture: StartFixture;
let forge: FakeForge;
let scanApp: AppServer;
let emptyApp: AppServer;

test.beforeAll(async () => {
  scanFixture = createStartFixture();
  emptyFixture = createStartFixture();
  forge = await startFakeForge();
  scanApp = await startApp(scanFixture, forge.url);
  emptyApp = await startApp(emptyFixture, forge.url);
});

test.afterAll(async () => {
  await scanApp.stop();
  await emptyApp.stop();
  await forge.stop();
  scanFixture.cleanup();
  emptyFixture.cleanup();
});

test('offers the repositories inside the start folder and adds only the chosen one', async ({ page }) => {
  // The CLI URL sets the session cookie; the folder is passed again explicitly by the test.
  await page.goto(scanApp.url);
  await page.goto(`${scanApp.baseUrl}/?open=${encodeURIComponent(scanFixture.scanRoot)}`);

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'No repository here' })).toBeVisible();
  const foundOne = dialog.getByRole('listitem').filter({ hasText: 'found-one' });
  const foundTwo = dialog.getByRole('listitem').filter({ hasText: 'found-two' });
  await expect(foundOne).toBeVisible();
  await expect(foundTwo).toBeVisible();

  await foundOne.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Add selected (1)' }).click();

  // One added repository opens its review directly.
  await expect(page).toHaveURL(/\/repo\/[^/?]+$/);
  await page.goto(`${scanApp.baseUrl}/`);
  await expect(page.getByRole('link', { name: 'found-one', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'found-two', exact: true })).toHaveCount(0);
});

test('an empty start folder gets a toast, not a red error or a dialog', async ({ page }) => {
  await page.goto(emptyApp.url);
  await page.goto(`${emptyApp.baseUrl}/?open=${encodeURIComponent(emptyFixture.emptyFolder)}`);

  await expect(page.getByRole('heading', { name: /Review local changes/ })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Not a git repository' })).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'Not a git repository' })).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).toHaveURL(`${emptyApp.baseUrl}/`);
});

function createStartFixture(): StartFixture {
  const root = mkdtempSync(join(tmpdir(), 'ravi-e2e-start-'));
  const home = join(root, 'home');
  mkdirSync(home);
  writeFileSync(join(home, '.env'), 'GITHUB_TOKEN=e2e-token\n');
  const repoPath = join(root, 'start');
  mkdirSync(repoPath);
  const scanRoot = join(root, 'scan-root');
  mkdirSync(scanRoot);
  makeRepository(join(scanRoot, 'found-one'));
  makeRepository(join(scanRoot, 'found-two'));
  const emptyFolder = join(root, 'no-repositories');
  mkdirSync(emptyFolder);
  return { root, repoPath, home, scanRoot, emptyFolder, cleanup: () => removeTree(root) };
}

/** A minimal repository with one commit, so the dashboard can show a card for it after adding. */
function makeRepository(path: string): void {
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'README.md'), '# fixture\n');
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: path });
  execFileSync('git', ['add', '-A'], { cwd: path });
  execFileSync(
    'git',
    ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-q', '--no-verify', '-m', 'fixture'],
    { cwd: path, stdio: 'ignore' },
  );
}
