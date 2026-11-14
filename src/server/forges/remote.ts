/**
 * Remote URL detection.
 *
 * A local repository knows where it came from only through `origin`. Parsing the three common git
 * URL forms here keeps the rest of the server free of remote-string handling; anything that does not
 * name a repository on a registered host is treated as "no forge".
 */
import type { RepoRef } from '../../shared/forge.ts';
import { gitText } from '../git/exec.ts';
import { HOSTS } from './registry.ts';

/** Recognises `https://host/a/b(.git)`, `git@host:a/b(.git)` and `ssh://git@host(:port)/a/b(.git)`. */
export function parseRemoteUrl(url: string): RepoRef | null {
  const value = url.trim();
  if (value === '') {
    return null;
  }

  const scp = /^git@([^:/\s]+):(.+)$/.exec(value);
  if (scp !== null) {
    const host = scp[1];
    const project = projectPath(scp[2] ?? '');
    return host !== undefined && project !== null ? { host: host.toLowerCase(), project } : null;
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'ssh:') {
    return null;
  }
  const project = projectPath(parsed.pathname);
  return project === null ? null : { host: parsed.hostname.toLowerCase(), project };
}

/** Finds the forge of `origin` in a working tree; a missing remote or an unknown host is null. */
export async function detectRepoRef(root: string): Promise<RepoRef | null> {
  try {
    const url = (await gitText(root, ['remote', 'get-url', 'origin'])).trim();
    const ref = parseRemoteUrl(url);
    if (ref === null) {
      return null;
    }
    return HOSTS.some((host) => host.host === ref.host) ? ref : null;
  } catch {
    // No remote, no repository, or no git: the caller simply has no forge for this folder.
    return null;
  }
}

/** At least `owner/name`; nested GitLab groups stay as one project path. */
function projectPath(pathname: string): string | null {
  const segments = pathname.split('/').filter((segment) => segment !== '');
  if (segments.length < 2 || segments.some((segment) => segment === '.' || segment === '..')) {
    return null;
  }
  const last = segments[segments.length - 1] ?? '';
  if (last.endsWith('.git')) {
    segments[segments.length - 1] = last.slice(0, -4);
  }
  return segments.every((segment) => segment !== '') ? segments.join('/') : null;
}
