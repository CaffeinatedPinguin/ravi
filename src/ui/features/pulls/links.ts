/**
 * Link targets for file headers and comments.
 *
 * The server owns forge URL shapes; the browser only fills `{path}` and `{line}` in a template.
 * Everything here is pure so the encoding and the `path:line` text can be tested without a DOM.
 */
import type { CommentSide } from '../../../shared/review.ts';

export type LinkMode = 'url' | 'path';

export type LinkContext = {
  mode: LinkMode;
  /** Absolute working tree path for local folders; null for remote clones (repo-relative paths). */
  repoPath: string | null;
  /** New-side template with `{path}` / `{line}`, or null when the repository has no forge remote. */
  urlTemplate: string | null;
  /** Base-side template for old lines and deleted files. */
  oldUrlTemplate: string | null;
};

export type LinkTarget = {
  /** Text shown to the reader and copied in path mode. */
  text: string;
  /** Forge URL opened in a new tab in URL mode; null when the link is copied instead. */
  href: string | null;
};

/**
 * Fills a server template. Path segments are encoded one by one so `/` stays a separator while
 * spaces and `#` in a file name cannot break the URL.
 */
export function fillFileUrlTemplate(template: string, path: string, line: number): string {
  const encoded = path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  // split/join instead of replace: a path containing `$&` must stay literal.
  return template.split('{path}').join(encoded).split('{line}').join(String(line));
}

/** `path:line` for local folders (absolute) and remote repositories (repo-relative). */
export function pathLinkText(repoPath: string | null, path: string, line: number | null): string {
  const full = repoPath === null ? path : `${repoPath}/${path}`;
  return line === null ? full : `${full}:${line}`;
}

/**
 * The link for one file or comment. URL mode falls back to path mode when the forge template is
 * missing, so a repository without a remote still gets copyable links instead of a dead href.
 */
export function linkFor(context: LinkContext, path: string, side: CommentSide, line: number | null): LinkTarget {
  const template = side === 'old' ? (context.oldUrlTemplate ?? context.urlTemplate) : context.urlTemplate;
  if (context.mode === 'url' && template !== null) {
    return { text: pathLinkText(context.repoPath, path, line), href: fillFileUrlTemplate(template, path, line ?? 1) };
  }
  return { text: pathLinkText(context.repoPath, path, line), href: null };
}
