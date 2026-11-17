/**
 * Everything ravi owns on disk lives under one folder (`~/.ravi` by default), so it is easy to find
 * and to delete. `RAVI_HOME` overrides the location: the launchers written by the installers set it
 * to the install folder, and tests and development use it to stay out of the real folder.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

export type Paths = {
  home: string;
  /** Tokens, written by the user, never by ravi. */
  envFile: string;
  data: string;
  assets: string;
  clones: string;
};

export function resolvePaths(env: NodeJS.ProcessEnv = process.env): Paths {
  const home = env.RAVI_HOME ?? join(homedir(), '.ravi');
  const data = join(home, 'data');
  return {
    home,
    envFile: join(home, '.env'),
    data,
    assets: join(data, 'assets'),
    clones: join(home, 'clones'),
  };
}
