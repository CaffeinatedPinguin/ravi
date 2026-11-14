/**
 * Serves the UI that the build embedded into the single `revu.mjs` file.
 * Assets are stored gzip-compressed and are sent as-is to clients that accept gzip.
 */
import type { IncomingMessage } from 'node:http';
import { gunzipSync } from 'node:zlib';
import { raw } from './router.ts';
import type { RawResponse } from './router.ts';

/**
 * Headers every response carries (UI and API).
 *
 * The CSP is strict because comment bodies can contain untrusted Markdown: scripts only from our
 * own build, styles need `unsafe-inline` for the theme variables React writes as style attributes,
 * images may be data/blob URLs from the editor, and the shiki worker is same-origin (+ blob for the
 * bundler's worker wrapper). `frame-ancestors`/`x-frame-options` stop clickjacking of a page that
 * can send reviews, and `no-referrer` keeps forge URLs (project names, PR ids) out of third-party
 * referrers.
 */
export const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";

export const SECURITY_HEADERS: Record<string, string> = {
  'content-security-policy': CSP,
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
};

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
    ...SECURITY_HEADERS,
    'content-type': asset.type,
    // Vite fingerprints everything under /assets, so those can be cached forever.
    'cache-control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
  };
  const acceptsGzip = /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''));
  if (acceptsGzip) {
    return raw(200, { ...headers, 'content-encoding': 'gzip' }, asset.gzip);
  }
  return raw(200, headers, gunzipSync(asset.gzip));
}
