import { mkdirSync, mkdtempSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { MAX_ASSET_BYTES } from '../../shared/api.ts';
import { resolvePaths } from '../paths.ts';
import { importLocalImage, readAsset, saveAsset } from './assets.ts';

const home = mkdtempSync(join(tmpdir(), 'ravi-assets-'));
const paths = resolvePaths({ RAVI_HOME: home });
const workspace = mkdtempSync(join(tmpdir(), 'ravi-assets-work-'));
const repo = join(workspace, 'repo');
const outside = join(workspace, 'outside');

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('pixels')]);

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(workspace, { recursive: true, force: true });
});

describe('asset store', () => {
  it('stores a real PNG by content and reads it back byte for byte; storing twice returns the same id', async () => {
    const first = await saveAsset(paths, { name: 'shot.png', type: 'image/png', data: PNG });
    const second = await saveAsset(paths, { name: 'copy.png', type: 'image/png', data: PNG });

    expect(first).toMatch(/^[a-f0-9]{64}\.png$/);
    expect(second).toBe(first);
    const stored = await readAsset(paths, first);
    expect(stored.type).toBe('image/png');
    expect(stored.data.equals(PNG)).toBe(true);
  });

  it('rejects bytes whose magic does not match the declared type', async () => {
    await expect(saveAsset(paths, { name: 'fake.png', type: 'image/png', data: Buffer.from('not an image') })).rejects.toThrow(
      /does not match/,
    );
  });

  it('rejects an image over 10 MiB', async () => {
    await expect(saveAsset(paths, { name: 'huge.png', type: 'image/png', data: Buffer.alloc(11 * 1024 * 1024) })).rejects.toThrow(
      /10 MiB/,
    );
  });

  it('rejects ids that could escape the assets folder', async () => {
    await expect(readAsset(paths, '../x.png')).rejects.toThrow(/Invalid asset id/);
    await expect(readAsset(paths, 'ABC.png')).rejects.toThrow(/Invalid asset id/);
    await expect(readAsset(paths, `${'a'.repeat(64)}.svg`)).rejects.toThrow(/Invalid asset id/);
  });
});

describe('importLocalImage', () => {
  it('copies an image inside the repository into the assets folder', async () => {
    mkdirp(repo);
    const file = join(repo, 'screenshot.png');
    writeFileSync(file, PNG);

    const id = await importLocalImage(paths, repo, file);
    expect(id).toMatch(/^[a-f0-9]{64}\.png$/);
    expect((await readAsset(paths, id)).data.equals(PNG)).toBe(true);
  });

  it('refuses a file outside both the repository and the assets folder', async () => {
    mkdirp(outside);
    const file = join(outside, 'secret.png');
    writeFileSync(file, PNG);
    await expect(importLocalImage(paths, repo, file)).rejects.toThrow(/outside the repository/);
  });

  it('rejects an oversized file from its size before reading it', async () => {
    mkdirp(repo);
    const file = join(repo, 'huge.png');
    writeFileSync(file, PNG);
    // A sparse file keeps the test fast; `stat` sees the full size without reading the bytes.
    truncateSync(file, MAX_ASSET_BYTES + 1);
    await expect(importLocalImage(paths, repo, file)).rejects.toThrow(/10 MiB/);
  });

  it('refuses a symlink inside the repository that points outside it', async () => {
    mkdirp(repo);
    mkdirp(outside);
    const secret = join(outside, 'linked.png');
    writeFileSync(secret, PNG);
    const link = join(repo, 'link.png');
    try {
      symlinkSync(secret, link);
    } catch {
      // Windows denies symlink creation without developer mode or elevation; the case stays covered.
      return;
    }
    await expect(importLocalImage(paths, repo, link)).rejects.toThrow(/outside the repository/);
  });
});

function mkdirp(folder: string): void {
  mkdirSync(folder, { recursive: true });
}
