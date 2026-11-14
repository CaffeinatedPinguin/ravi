/**
 * Everything revu owns on disk lives under one folder (`~/.revu`), so it is easy to find and to delete.
 * `REVU_HOME` overrides the location; tests and development use it to stay out of the real folder.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

export type Paths = {
  home: string;
  /** Tokens, written by the user, never by revu. */
  envFile: string;
  data: string;
  assets: string;
  clones: string;
};

export function resolvePaths(env: NodeJS.ProcessEnv = process.env): Paths {
  const home = env.REVU_HOME ?? join(homedir(), '.revu');
  const data = join(home, 'data');
  return {
    home,
    envFile: join(home, '.env'),
    data,
    assets: join(data, 'assets'),
    clones: join(home, 'clones'),
  };
}
