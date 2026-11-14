/**
 * Token storage: revu reads `~/.revu/.env` and nothing else.
 *
 * The environment is deliberately ignored: a token exported in a shell profile would leak into
 * child processes and be hard to rotate. Values are cached because every API call needs them, and
 * changing the file requires an explicit reload (or a restart).
 */
import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';

const cache = new Map<string, Map<string, string>>();

/** Reads the named file once per process; a missing file simply has no tokens. */
export async function readForgeTokens(envFile: string): Promise<Map<string, string>> {
  const cached = cache.get(envFile);
  if (cached !== undefined) {
    return cached;
  }
  const tokens = await load(envFile);
  cache.set(envFile, tokens);
  return tokens;
}

/** Drops every cached file so the next read sees edits; never logs or returns values. */
export function reloadForgeTokens(): void {
  cache.clear();
}

async function load(envFile: string): Promise<Map<string, string>> {
  let text: string;
  try {
    text = await readFile(envFile, 'utf8');
  } catch (error) {
    if (isMissing(error)) {
      return new Map();
    }
    throw error;
  }

  const tokens = new Map<string, string>();
  for (const [name, value] of Object.entries(parseEnv(text))) {
    const trimmed = (value ?? '').trim();
    if (trimmed !== '') {
      tokens.set(name, trimmed);
    }
  }
  return tokens;
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
