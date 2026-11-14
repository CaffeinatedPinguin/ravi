/**
 * Minimal JSON persistence: one file per document, validated on read, replaced atomically on write.
 * A crash mid-write leaves the previous file intact because the rename is the only visible step.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { z } from 'zod';

export async function readJsonFile<S extends z.ZodType>(file: string, schema: S, fallback: z.infer<S>): Promise<z.infer<S>> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if (isNotFound(error)) {
      return fallback;
    }
    throw error;
  }
  return schema.parse(JSON.parse(text));
}

export async function writeJsonFile(file: string, value: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, file);
}

export function isNotFound(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
