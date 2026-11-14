/**
 * Images attached to comments, stored as content-addressed files under `data/assets`.
 *
 * The id is the SHA-256 of the bytes plus an extension from the declared type, so the same picture
 * always maps to the same file and a duplicate upload costs nothing. Magic bytes are checked because
 * a browser-provided content type is not trustworthy; the id is the only value that ever reaches a
 * path, and serving validates it against a fixed pattern first.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, sep } from 'node:path';
import { ASSET_ID_PATTERN, MAX_ASSET_BYTES } from '../../shared/api.ts';
import type { AssetType } from '../../shared/api.ts';
import { HttpError } from '../http/router.ts';
import type { Paths } from '../paths.ts';

const CONTENT_TYPES: AssetType[] = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

const EXTENSION: Record<AssetType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

const TYPE_BY_EXTENSION: Record<string, AssetType> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

export type StoredAsset = { data: Buffer; type: AssetType };

export type AssetInput = {
  /** Original file name, kept for the caller's logs; the id comes from the bytes. */
  name: string;
  type: AssetType;
  data: Buffer;
};

export async function saveAsset(paths: Paths, input: AssetInput): Promise<string> {
  const { type, data } = input;
  assertSize(data);
  if (!matchesType(data, type)) {
    throw new HttpError(400, 'Image data does not match the declared type');
  }
  const id = `${createHash('sha256').update(data).digest('hex')}.${EXTENSION[type]}`;
  await mkdir(paths.assets, { recursive: true });
  try {
    // `wx` keeps the write idempotent: a second upload of the same bytes finds the file and stops.
    await writeFile(join(paths.assets, id), data, { flag: 'wx' });
  } catch (error) {
    if (!isAlreadyExists(error)) {
      throw error;
    }
  }
  return id;
}

export async function readAsset(paths: Paths, id: string): Promise<StoredAsset> {
  // The pattern is the path-traversal guard: `..`, separators and uppercase names never match.
  if (!ASSET_ID_PATTERN.test(id)) {
    throw new HttpError(400, 'Invalid asset id');
  }
  const type = TYPE_BY_EXTENSION[id.slice(id.lastIndexOf('.') + 1)];
  if (type === undefined) {
    throw new HttpError(400, 'Invalid asset id');
  }
  try {
    return { data: await readFile(join(paths.assets, id)), type };
  } catch (error) {
    if (isNotFound(error)) {
      throw new HttpError(404, 'Asset not found');
    }
    throw error;
  }
}

/**
 * Copies an image referenced from imported Markdown into the assets folder.
 *
 * Only files inside the repository or already inside the assets folder are allowed: an imported
 * review may later be sent to a forge, so the text must not be able to pull arbitrary local files
 * into it. `realpath` resolves symlinks first, which is what stops a link inside the repo from
 * smuggling in a file outside it.
 */
export async function importLocalImage(paths: Paths, repoRoot: string, absPath: string): Promise<string> {
  if (!isAbsolute(absPath)) {
    throw new HttpError(400, 'Image path is not absolute');
  }
  let target: string;
  try {
    target = await realpath(absPath);
  } catch {
    throw new HttpError(404, 'Image not found');
  }
  await mkdir(paths.assets, { recursive: true });
  const [root, assets] = await Promise.all([realpath(repoRoot), realpath(paths.assets)]);
  if (!isInside(target, assets) && !isInside(target, root)) {
    throw new HttpError(400, 'Image path is outside the repository and the assets folder');
  }
  const data = await readFile(target);
  assertSize(data);
  const type = detectType(data);
  if (type === null) {
    throw new HttpError(400, 'File is not a supported image');
  }
  return saveAsset(paths, { name: basename(target), type, data });
}

function assertSize(data: Buffer): void {
  if (data.length > MAX_ASSET_BYTES) {
    throw new HttpError(413, 'Image is larger than 10 MiB');
  }
}

function detectType(data: Buffer): AssetType | null {
  for (const type of CONTENT_TYPES) {
    if (matchesType(data, type)) {
      return type;
    }
  }
  return null;
}

function matchesType(data: Buffer, type: AssetType): boolean {
  switch (type) {
    case 'image/png':
      return startsWith(data, [0x89, 0x50, 0x4e, 0x47]);
    case 'image/jpeg':
      return startsWith(data, [0xff, 0xd8, 0xff]);
    case 'image/gif':
      return startsWith(data, [0x47, 0x49, 0x46, 0x38]);
    case 'image/webp':
      // RIFF container: the four bytes at offset 8 identify WEBP inside it.
      return startsWith(data, [0x52, 0x49, 0x46, 0x46]) && startsWith(data.subarray(8), [0x57, 0x45, 0x42, 0x50]);
  }
}

function startsWith(data: Buffer, bytes: number[]): boolean {
  return bytes.every((byte, index) => data[index] === byte);
}

/** True when `child` is strictly below `parent`; the root itself does not count. */
function isInside(child: string, parent: string): boolean {
  const offset = relative(parent, child);
  return offset !== '' && offset !== '..' && !offset.startsWith(`..${sep}`) && !isAbsolute(offset);
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST';
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
