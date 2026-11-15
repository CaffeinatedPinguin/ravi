/**
 * The dashboard proof: first-run setup with nothing connected, then a repository with local changes
 * and the three pull request groups. The app runs from `dist/revu.mjs`; the forge is a tiny loopback
 * server so no request leaves the machine.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { startApp } from './support/app.ts';
import type { AppServer } from './support/app.ts';
import { createFixture } from './support/fixture.ts';
import type { Fixture } from './support/fixture.ts';
import { shot } from './support/screenshots.ts';

type DashboardForge = { url: string; stop: () => Promise<void> };

const PROJECT = '/repos/e2e/sample';
const CREATED_AT = '2026-11-14T10:00:00Z';

function pull(number: number, title: string, author: string, requested: boolean): Record<string, unknown> {
  return {
    number,
    title,
    user: { login: author },
    state: 'open',
    draft: false,
    updated_at: CREATED_AT,
    base: { ref: 'main', sha: 'base-sha' },
    head: { ref: `feature-${number}`, sha: `head-${number}` },
    html_url: `https://github.com/e2e/sample/pull/${number}`,
    merged_at: null,
    requested_reviewers: requested ? [{ login: 'e2e-user' }] : [],
  };
}

function startDashboardForge(): Promise<DashboardForge> {
  const pulls = [
    pull(2, 'Needs your review', 'alice', true),
    pull(3, 'Mine in progress', 'e2e-user', false),
    pull(4, 'Other open work', 'bob', false),
  ];
  const server = createServer((request, response) => {
    void handle(request, response);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        stop: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    await new Promise((done) => request.resume().on('end', done));
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    if (request.method === 'GET' && pathname === '/user') {
      send(response, 200, { login: 'e2e-user' });
    } else if (request.method === 'GET' && pathname === `${PROJECT}/pulls`) {
      send(response, 200, pulls);
    } else if (request.method === 'GET' && /comments$/.test(pathname)) {
      send(response, 200, []);
    } else {
      send(response, 404, { message: 'Not Found' });
    }
  }
}

function send(response: ServerResponse, status: number, value: unknown): void {
  const payload = JSON.stringify(value);
  response.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) });
  response.end(payload);
}

/** A fresh home with no repositories; the folder itself is deliberately not a git repository. */
function emptyFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'revu-e2e-setup-'));
  const repoPath = join(root, 'not-a-repo');
  const home = join(root, 'home');
  mkdirSync(repoPath);
  mkdirSync(home);
  writeFileSync(join(home, '.env'), 'GITHUB_TOKEN=e2e-token\n');
  return { root, repoPath, home, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test.describe('dashboard', () => {
  let setupFixture: Fixture;
  let fixture: Fixture;
  let forge: DashboardForge;
  let setupApp: AppServer;
  let app: AppServer;

  test.beforeAll(async () => {
    setupFixture = emptyFixture();
    fixture = createFixture();
    // The fixture has no remote; the fake forge still speaks for e2e/sample.
    execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/e2e/sample.git'], { cwd: fixture.repoPath });
    forge = await startDashboardForge();
    setupApp = await startApp(setupFixture, forge.url);
    app = await startApp(fixture, forge.url);
  });

  test.afterAll(async () => {
    await app.stop();
    await setupApp.stop();
    await forge.stop();
    fixture.cleanup();
    setupFixture.cleanup();
  });

  test('first run shows the setup screen with the brand', async ({ page }) => {
    await page.goto(setupApp.url);
    await page.goto(`${setupApp.baseUrl}/`);

    await expect(page.getByRole('heading', { name: /Review local changes/ })).toBeVisible();
    await expect(page.getByRole('link', { name: 'revu by smrodek.xyz' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add your first repository' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'How tokens work' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Notifications/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible();

    await shot(page, setupApp.baseUrl, 'setup');
  });

  test('dashboard lists local changes and the three pull request groups', async ({ page }) => {
    // Opening the CLI URL connects the folder asynchronously; leave that page only once it is stored.
    await page.goto(app.url);
    await expect(page.getByRole('navigation', { name: 'Changed files' })).toBeVisible();
    await page.goto(`${app.baseUrl}/`);

    await expect(page.getByRole('heading', { name: 'revu', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'sample-repo' })).toBeVisible();
    await expect(page.getByText(/untracked/)).toBeVisible();
    await expect(page.getByRole('heading', { name: /Waiting for my review/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: /^Mine/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Other open/ })).toBeVisible();
    await expect(page.getByText('Needs your review')).toBeVisible();
    await expect(page.getByText('Mine in progress')).toBeVisible();
    await expect(page.getByText('Other open work')).toBeVisible();
    await expect(page.getByRole('button', { name: /Notifications/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible();

    await shot(page, app.baseUrl, 'dashboard');
  });
});
