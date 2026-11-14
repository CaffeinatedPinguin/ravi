/**
 * Starts the built `dist/revu.mjs` against the fixture, with the E2E forge override and a fresh
 * `REVU_HOME`. The CLI prints the one-time token URL; opening it in the page sets the session cookie.
 * The gate builds `dist/` before this runs.
 */
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Fixture } from './fixture.ts';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const ENTRY = join(REPO_ROOT, 'dist', 'revu.mjs');
const START_TIMEOUT_MS = 20_000;

export type AppServer = {
  /** Token URL from the CLI; opening it sets the session cookie. */
  url: string;
  baseUrl: string;
  stop: () => Promise<void>;
};

export async function startApp(fixture: Fixture, forgeUrl: string): Promise<AppServer> {
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [ENTRY, fixture.repoPath, '--no-open', '--port', String(port)], {
    cwd: REPO_ROOT,
    env: { ...process.env, REVU_HOME: fixture.home, REVU_E2E: '1', REVU_E2E_FORGE: forgeUrl },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string) => {
    stderr += chunk;
  });
  return { url: await printedUrl(child, () => stderr), baseUrl, stop: () => stopChild(child) };
}

/** Waits for the `Open:` line; stderr is kept for a failure message. */
function printedUrl(child: ChildProcess, stderr: () => string): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(
      () => reject(new Error(`revu did not start in ${START_TIMEOUT_MS} ms:\n${output}\n${stderr()}`)),
      START_TIMEOUT_MS,
    );
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      output += chunk;
      const url = /Open: (http:\/\/127\.0\.0\.1:\d+\/\S+)/.exec(output)?.[1];
      if (url !== undefined) {
        clearTimeout(timer);
        resolve(url);
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`revu exited with ${String(code)}:\n${output}\n${stderr()}`));
    });
  });
}

function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) {
    return Promise.resolve();
  }
  child.kill();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 5000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}
