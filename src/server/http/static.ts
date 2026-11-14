/**
 * Serves the UI that the build embedded into the single `revu.mjs` file.
 * Assets are stored gzip-compressed and are sent as-is to clients that accept gzip.
 */
import type { IncomingMessage } from 'node:http';
import { gunzipSync } from 'node:zlib';
import { raw } from './router.ts';
import type { RawResponse } from './router.ts';

/** What the build embeds: path → content type and base64 of the gzip-compressed bytes. */
export type EncodedUiAssets = Record<string, { type: string; gzipBase64: string }>;

/** Path (e.g. `/assets/app-abc.js`) → content type and gzip-compressed bytes. */
export type UiAssets = Map<string, { type: string; gzip: Buffer }>;

export function decodeUiAssets(encoded: EncodedUiAssets): UiAssets {
  return new Map(
    Object.entries(encoded).map(([path, asset]) => [path, { type: asset.type, gzip: Buffer.from(asset.gzipBase64, 'base64') }]),
  );
}

export function serveUiAsset(assets: UiAssets, req: IncomingMessage, pathname: string): RawResponse | null {
  // Client-side routes have no file extension and all resolve to the app shell.
  const isFile = /\.[a-z0-9]+$/i.test(pathname);
  const asset = assets.get(isFile ? pathname : '/index.html');
  if (!asset) {
    return null;
  }
  const headers: Record<string, string> = {
    'content-type': asset.type,
    // Vite fingerprints everything under /assets, so those can be cached forever.
    'cache-control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    'x-content-type-options': 'nosniff',
  };
  const acceptsGzip = /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''));
  if (acceptsGzip) {
    return raw(200, { ...headers, 'content-encoding': 'gzip' }, asset.gzip);
  }
  return raw(200, headers, gunzipSync(asset.gzip));
}
