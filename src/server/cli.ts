/**
 * Command line entry: `revu [path] [--port N] [--no-open]`.
 * Starts the local server (or reuses the one already running) and opens the review UI.
 */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createRouter, VERSION } from './app.ts';
import { createHttpServer } from './http/server.ts';
import type { UiAssets } from './http/static.ts';
import { findRunningInstance, forgetInstance, loadOrCreateToken, recordInstance } from './instance.ts';
import { openBrowser } from './open-browser.ts';
import { resolvePaths } from './paths.ts';

/** Fixed by default so bookmarks and the session cookie keep working between runs. */
const DEFAULT_PORT = 4783;

const HELP = `revu ${VERSION} - local code review

Usage: revu [path] [options]

  path           Folder with a git repository to open (default: current folder)

Options:
  --port <n>     Port to listen on (default: ${DEFAULT_PORT})
  --no-open      Do not open the browser
  --version      Print the version
  --help         Print this help
`;

export type RunOptions = {
  /** Embedded UI; `null` when a dev server (Vite) serves it instead. */
  assets: UiAssets | null;
  /** `host:port` of the Vite dev server that serves the UI and proxies the API in development. */
  devUiOrigin?: string;
};

export async function run(argv: string[], options: RunOptions): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      port: { type: 'string' },
      'no-open': { type: 'boolean', default: false },
      version: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.version) {
    console.log(VERSION);
    return;
  }
  if (values.help) {
    console.log(HELP);
    return;
  }

  const paths = resolvePaths();
  const token = await loadOrCreateToken(paths);
  const folder = resolve(positionals[0] ?? process.cwd());
  const shouldOpen = !values['no-open'];

  const running = await findRunningInstance(paths, token);
  if (running) {
    const url = appUrl(`127.0.0.1:${running.port}`, token, folder);
    console.log(`revu is already running: http://127.0.0.1:${running.port}`);
    if (shouldOpen) {
      openBrowser(url);
    }
    return;
  }

  const requestedPort = values.port === undefined ? undefined : parsePort(values.port);
  // Filled after listening, because the port may end up being picked by the OS.
  const allowedHosts: string[] = [];
  const server = createHttpServer({
    router: createRouter({ paths }),
    assets: options.assets,
    security: { token, allowedHosts, skipSession: options.devUiOrigin !== undefined },
  });
  const port = await listen(server, requestedPort);
  allowedHosts.push(`127.0.0.1:${port}`, `localhost:${port}`);

  await recordInstance(paths, { port, pid: process.pid });
  registerShutdown(server, () => forgetInstance(paths));

  const uiHost = options.devUiOrigin ?? `127.0.0.1:${port}`;
  console.log(`revu ${VERSION} listening on http://127.0.0.1:${port}`);
  console.log(`Open: ${appUrl(uiHost, token, folder)}`);
  if (shouldOpen) {
    openBrowser(appUrl(uiHost, token, folder));
  }
}

function appUrl(host: string, token: string, folder: string): string {
  const query = new URLSearchParams({ token, open: folder });
  return `http://${host}/?${query.toString()}`;
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid --port value: ${value}`);
  }
  return port;
}

/** Listens on the requested port; without an explicit request, falls back to a free port if the default is taken. */
function listen(server: Server, requestedPort: number | undefined): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE' && requestedPort === undefined) {
        server.listen(0, '127.0.0.1');
        return;
      }
      reject(error);
    };
    server.on('error', onError);
    server.on('listening', () => {
      server.off('error', onError);
      resolvePort((server.address() as AddressInfo).port);
    });
    // Loopback only: the API must never be reachable from the network.
    server.listen(requestedPort ?? DEFAULT_PORT, '127.0.0.1');
  });
}

function registerShutdown(server: Server, cleanup: () => Promise<void>): void {
  const shutdown = () => {
    server.close();
    cleanup()
      .catch(() => undefined)
      .finally(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
