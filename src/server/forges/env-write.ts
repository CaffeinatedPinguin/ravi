/**
 * The only writer of `~/.ravi/.env`.
 *
 * Tokens are written here only from Settings, so a user no longer has to edit the file by hand.
 * The file is shared with the user: comments, ordering and unrelated variables must survive
 * byte-for-byte, which is why this is a line editor rather than a parse/re-print round trip.
 * The replacement is written to a temporary file with mode 0600 and renamed, so a crash never
 * leaves a half-written or world-readable token file.
 */
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { HttpError } from '../http/router.ts';
import { reloadForgeTokens } from './env.ts';

const NAME_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;
const MAX_VALUE_LENGTH = 512;

/**
 * Writes `NAME=value`, or removes every line for `NAME` when `value` is null.
 * Returns without touching the file when nothing would change.
 */
export async function setEnvVar(file: string, name: string, value: string | null): Promise<void> {
  assertName(name);
  if (value !== null) {
    assertValue(value);
  }

  const current = await readText(file);
  const { text, changed } = edit(current, name, value);
  if (!changed) {
    return;
  }

  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporary, text, { mode: 0o600 });
    await rename(temporary, file);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  // The registry caches values per process; the next API call must see the new token.
  reloadForgeTokens();
}

/**
 * `parseEnv` understands double-quoted values, so whitespace and `#` (which would start a comment)
 * make quoting necessary. Backslashes and quotes are escaped only inside that quoted form.
 */
export function formatEnvValue(value: string): string {
  if (!/[\s#'"]|\\/.test(value)) {
    return value;
  }
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

function edit(current: string, name: string, value: string | null): { text: string; changed: boolean } {
  const eol = current.includes('\r\n') ? '\r\n' : '\n';
  const lines = current.split('\n');
  const matcher = new RegExp(`^[ \\t]*(?:export[ \\t]+)?${name}[ \\t]*=`);
  const output: string[] = [];
  let found = false;
  let changed = false;

  for (const line of lines) {
    if (!matcher.test(line)) {
      output.push(line);
      continue;
    }
    // A duplicate definition is dropped: keeping it could shadow the value just written.
    const first = !found;
    found = true;
    if (!first) {
      changed = true;
      continue;
    }
    if (value === null) {
      changed = true;
      continue;
    }
    const replacement = `${name}=${formatEnvValue(value)}${line.endsWith('\r') ? '\r' : ''}`;
    changed = changed || replacement !== line;
    output.push(replacement);
  }

  if (!found && value !== null) {
    const assignment = `${name}=${formatEnvValue(value)}${eol === '\r\n' ? '\r' : ''}`;
    // Keep a trailing newline when there is one; add one after a last line without it.
    if (output.at(-1) === '') {
      output.splice(output.length - 1, 0, assignment);
    } else {
      output.push(assignment, '');
    }
    changed = true;
  }

  return { text: output.join('\n'), changed };
}

async function readText(file: string): Promise<string> {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if (isMissing(error)) {
      return '';
    }
    throw error;
  }
}

function assertName(name: string): void {
  if (!NAME_PATTERN.test(name)) {
    throw new HttpError(400, 'Invalid token variable name');
  }
}

/** Error messages must never repeat the value: they end up in HTTP answers and logs. */
function assertValue(value: string): void {
  if (value.length > MAX_VALUE_LENGTH) {
    throw new HttpError(400, `A token is at most ${MAX_VALUE_LENGTH} characters long`);
  }
  if (/[\r\n]/.test(value)) {
    throw new HttpError(400, 'A token must be a single line');
  }
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
