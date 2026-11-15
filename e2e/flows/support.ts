/**
 * Helpers shared by the flow specs: fixture repositories, the local "insteadOf" route to a bare
 * remote (so `git fetch` never leaves the machine), session opening and a live screenshot helper.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { removeTree } from '../support/fixture.ts';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { Page } from '@playwright/test';
import type { Fixture } from '../support/fixture.ts';

const AUTHOR = ['-c', 'user.name=flow-fixture', '-c', 'user.email=flow@example.invalid'];

/** Runs git with a fixed identity, so the host's global git configuration cannot change the fixture. */
export function git(cwd: string, args: readonly string[]): string {
  return execFileSync('git', [...AUTHOR, ...args], { cwd, encoding: 'utf8' });
}

export type PullRequestFixture = Fixture & {
  /** Bare repository the fixture's origin is rewritten to. */
  barePath: string;
  baseSha: string;
  headSha: string;
};

/**
 * A repository with a `main` base commit and a `feature` commit that changes `src/util.ts` line 2.
 * The bare remote carries `refs/pull/1/head`, so the server's `git fetch origin pull/1/head` works.
 */
export function createPullRequestFixture(): PullRequestFixture {
  const root = mkdtempSync(join(tmpdir(), 'ravi-e2e-pr-'));
  const repoPath = join(root, 'pr-repo');
  const home = join(root, 'home');
  const barePath = join(root, 'forge-remote');
  mkdirSync(repoPath, { recursive: true });
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, '.env'), 'GITHUB_TOKEN=e2e-token\n');

  const file = (path: string, content: string): void => {
    mkdirSync(dirname(join(repoPath, path)), { recursive: true });
    writeFileSync(join(repoPath, path), content);
  };
  const util = (body: string): string => `export function sum(values: number[]): number {\n  ${body}\n}\n`;

  file('README.md', '# pr sample\n');
  file('src/util.ts', util('return values.reduce((a, b) => a + b, 0);'));
  file('src/app.ts', 'export const name = "sample";\n');

  git(repoPath, ['init', '-q', '-b', 'main']);
  git(repoPath, ['add', '-A']);
  git(repoPath, ['commit', '-q', '--no-verify', '-m', 'base']);
  const baseSha = git(repoPath, ['rev-parse', 'HEAD']).trim();

  git(repoPath, ['checkout', '-q', '-b', 'feature']);
  file('src/util.ts', util('return values.reduce((sum, value) => sum + value, 0);'));
  git(repoPath, ['add', '-A']);
  git(repoPath, ['commit', '-q', '--no-verify', '-m', 'feature']);
  const headSha = git(repoPath, ['rev-parse', 'HEAD']).trim();

  // A bare repository served through git's local transport; refs/pull/1/head is what GitHub shows.
  git(root, ['init', '--bare', '-q', '-b', 'main', barePath]);
  git(root, [
    '--git-dir',
    barePath,
    'fetch',
    repoPath,
    '+refs/heads/feature:refs/pull/1/head',
    '+refs/heads/main:refs/heads/main',
  ]);
  git(root, ['--git-dir', barePath, 'symbolic-ref', 'HEAD', 'refs/heads/main']);

  // The stored forge remote comes from this URL; the actual fetch is redirected below.
  git(repoPath, ['remote', 'add', 'origin', 'https://github.com/e2e/sample.git']);

  return { root, repoPath, home, barePath, baseSha, headSha, cleanup: () => removeTree(root) };
}

/**
 * `git fetch` reads the repository config, so a section appended after the repository is connected
 * rewrites only the transport URL. `remote get-url`/repository detection have already run by then.
 */
export function routeOriginToLocalBare(repoPath: string, barePath: string): void {
  const url = barePath.replaceAll('\\', '/');
  appendFileSync(
    join(repoPath, '.git', 'config'),
    `\n[url "${url}"]\n\tinsteadOf = https://github.com/e2e/sample.git\n`,
  );
}

/** A fresh home with no repositories; `repoPath` is deliberately not a git repository. */
export function emptyHomeFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'ravi-e2e-setup-'));
  const repoPath = join(root, 'not-a-repo');
  const home = join(root, 'home');
  mkdirSync(repoPath);
  mkdirSync(home);
  return { root, repoPath, home, cleanup: () => removeTree(root) };
}

/** A minimal git repository with one commit, used as the folder picked in the first-run wizard. */
export function makeRepository(path: string): string {
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'README.md'), '# fixture\n');
  git(path, ['init', '-q', '-b', 'main']);
  git(path, ['add', '-A']);
  git(path, ['commit', '-q', '--no-verify', '-m', 'fixture']);
  return path;
}

/** Opens the CLI's token handshake without its `open` parameter, so no repository is added. */
export async function openSession(page: Page, app: { url: string; baseUrl: string }): Promise<void> {
  const token = new URL(app.url).searchParams.get('token');
  if (token === null) {
    throw new Error('The app URL carries no session token');
  }
  await page.goto(`${app.baseUrl}/?token=${encodeURIComponent(token)}`);
}

/** Repository id from a `/repo/<id>` URL, after the CLI's `open` parameter connected the folder. */
export function repoIdFrom(page: Page): string {
  const match = /\/repo\/([^/?]+)/.exec(new URL(page.url()).pathname);
  if (match?.[1] === undefined) {
    throw new Error(`Not on a repository page: ${page.url()}`);
  }
  return match[1];
}

/**
 * Light and dark screenshots of the current state, without reloading.
 *
 * `shot()` reloads to apply a saved theme; that is right for stable pages but destroys transient
 * state (an open confirmation dialog, an "Approved by you" header). The theme contract is the
 * `data-theme` attribute on `<html>`, so setting it here captures the same real UI.
 */
export async function shotLive(page: Page, name: string): Promise<void> {
  const directory = resolve(process.env.RAVI_E2E_SCREENS ?? '.e2e-out/screens');
  mkdirSync(directory, { recursive: true });
  for (const theme of ['light', 'dark'] as const) {
    // The e2e TypeScript project has no DOM lib; a tiny expression keeps the same `data-theme`
    // contract the SettingsProvider writes, without pulling browser globals into Node types.
    await page.evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
    await page.screenshot({ path: join(directory, `${name}-${theme}.png`) });
  }
}
