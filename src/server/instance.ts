/**
 * One revu server per user. The session token and the running instance's port are kept on disk so
 * that a second `revu` invocation reuses the running server instead of starting another one, and
 * so that an already-open browser tab keeps working across restarts.
 */
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { HealthSchema } from '../shared/api.ts';
import { SESSION_COOKIE } from './http/security.ts';
import type { Paths } from './paths.ts';
import { isNotFound, readJsonFile, writeJsonFile } from './store/json-file.ts';

const InstanceSchema = z.object({ port: z.number().int(), pid: z.number().int() });
export type Instance = z.infer<typeof InstanceSchema>;

const tokenFile = (paths: Paths) => join(paths.data, 'session-token');
const instanceFile = (paths: Paths) => join(paths.data, 'instance.json');

export async function loadOrCreateToken(paths: Paths): Promise<string> {
  try {
    const token = (await readFile(tokenFile(paths), 'utf8')).trim();
    if (token.length >= 32) {
      return token;
    }
  } catch (error) {
    if (!isNotFound(error)) {
      throw error;
    }
  }
  const token = randomBytes(32).toString('hex');
  await mkdir(paths.data, { recursive: true });
  await writeFile(tokenFile(paths), `${token}\n`, { mode: 0o600 });
  return token;
}

/** Returns the recorded instance only if a revu server really answers on that port. */
export async function findRunningInstance(paths: Paths, token: string): Promise<Instance | null> {
  const instance = await readJsonFile(instanceFile(paths), InstanceSchema.nullable(), null).catch(() => null);
  if (!instance) {
    return null;
  }
  try {
    const response = await fetch(`http://127.0.0.1:${instance.port}/api/health`, {
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
      signal: AbortSignal.timeout(1500),
    });
    return response.ok && HealthSchema.safeParse(await response.json()).success ? instance : null;
  } catch {
    // A stale record (crashed server, port now used by something else) is not an error.
    return null;
  }
}

export async function recordInstance(paths: Paths, instance: Instance): Promise<void> {
  await writeJsonFile(instanceFile(paths), instance);
}

export async function forgetInstance(paths: Paths): Promise<void> {
  await rm(instanceFile(paths), { force: true });
}
