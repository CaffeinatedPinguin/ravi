/** User settings, kept on the server because browser storage is tied to the port and would not survive a port change. */
import { join } from 'node:path';
import { SettingsSchema } from '../../shared/api.ts';
import type { Settings } from '../../shared/api.ts';
import type { Paths } from '../paths.ts';
import { readJsonFile, writeJsonFile } from './json-file.ts';

const file = (paths: Paths) => join(paths.data, 'settings.json');

export function readSettings(paths: Paths): Promise<Settings> {
  // Parsing `{}` fills in every default, so new settings appear without a migration.
  return readJsonFile(file(paths), SettingsSchema, SettingsSchema.parse({}));
}

export async function writeSettings(paths: Paths, settings: Settings): Promise<Settings> {
  await writeJsonFile(file(paths), settings);
  return settings;
}
