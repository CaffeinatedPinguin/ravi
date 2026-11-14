/**
 * Development: the API server runs in-process on a fixed port and Vite serves the UI with hot
 * reload, proxying `/api` to it. State goes to `.revu-dev` so a real installation is untouched.
 */
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { run } from '../src/server/cli.ts';

const API_PORT = 4784;
const UI_PORT = 5173;

process.env.REVU_HOME ??= resolve('.revu-dev');

await run(['--no-open', '--port', String(API_PORT), ...process.argv.slice(2)], {
  assets: null,
  devUiOrigin: `localhost:${UI_PORT}`,
});

const vite = await createServer({
  server: {
    port: UI_PORT,
    strictPort: true,
    // changeOrigin rewrites the Host header to the address of the API, which its Host check requires.
    proxy: { '/api': { target: `http://127.0.0.1:${API_PORT}`, changeOrigin: true } },
  },
});
await vite.listen();
vite.printUrls();
