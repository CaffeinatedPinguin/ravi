/**
 * Bundles the server, all its dependencies and the built UI into the single file `dist/revu.mjs`.
 * That file plus Node is the whole installation: no node_modules, no asset folder.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';

const UI_DIR = 'dist/ui';
const VIRTUAL_ID = 'virtual:ui-assets';
const RESOLVED_ID = `\0${VIRTUAL_ID}`;

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/** Exposes every file of the built UI as `virtual:ui-assets` (gzip + base64), so it ships inside the bundle. */
function embedUiAssets(): Plugin {
  return {
    name: 'embed-ui-assets',
    resolveId: (id) => (id === VIRTUAL_ID ? RESOLVED_ID : null),
    load(id) {
      if (id !== RESOLVED_ID) {
        return null;
      }
      const assets: Record<string, { type: string; gzipBase64: string }> = {};
      for (const entry of readdirSync(UI_DIR, { recursive: true, withFileTypes: true })) {
        if (!entry.isFile()) {
          continue;
        }
        const file = join(entry.parentPath, entry.name);
        const type = CONTENT_TYPES[extname(entry.name)];
        if (type === undefined) {
          throw new Error(`No content type configured for UI asset ${file}`);
        }
        const urlPath = `/${relative(UI_DIR, file).replaceAll('\\', '/')}`;
        assets[urlPath] = { type, gzipBase64: gzipSync(readFileSync(file), { level: 9 }).toString('base64') };
      }
      return `export default ${JSON.stringify(assets)};`;
    },
  };
}

export default defineConfig({
  plugins: [embedUiAssets()],
  // Inline every dependency: the output must run with nothing but Node next to it.
  ssr: { noExternal: true },
  build: {
    ssr: 'src/server/main.ts',
    target: 'node22',
    outDir: 'dist',
    emptyOutDir: false,
    minify: false,
    rolldownOptions: {
      output: { entryFileNames: 'revu.mjs', codeSplitting: false },
    },
  },
});
