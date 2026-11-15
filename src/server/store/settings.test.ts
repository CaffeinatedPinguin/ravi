import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { resolvePaths } from '../paths.ts';
import { writeJsonFile } from './json-file.ts';
import { readSettings, writeSettings } from './settings.ts';

const home = mkdtempSync(join(tmpdir(), 'ravi-settings-store-'));
const paths = resolvePaths({ RAVI_HOME: home });

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
});

describe('settings store', () => {
  it('reads an old file without defaultBaseBranch as Automatic', async () => {
    await writeJsonFile(join(paths.data, 'settings.json'), { viewMode: 'split', ignoreWhitespace: true });

    await expect(readSettings(paths)).resolves.toMatchObject({
      viewMode: 'split',
      ignoreWhitespace: true,
      defaultBaseBranch: null,
    });
  });

  it('round-trips a saved default base branch', async () => {
    const settings = await readSettings(paths);
    await writeSettings(paths, { ...settings, defaultBaseBranch: 'release/1.2' });

    await expect(readSettings(paths)).resolves.toMatchObject({ defaultBaseBranch: 'release/1.2' });
  });
});
