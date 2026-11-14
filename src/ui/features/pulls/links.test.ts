import { describe, expect, it } from 'vitest';
import { fillFileUrlTemplate, linkFor, pathLinkText } from './links.ts';
import type { LinkContext } from './links.ts';

const TEMPLATE = 'https://github.com/acme/api/blob/abc123/{path}#L{line}';
const OLD_TEMPLATE = 'https://github.com/acme/api/blob/base456/{path}#L{line}';

function context(overrides: Partial<LinkContext> = {}): LinkContext {
  return {
    mode: 'path',
    repoPath: '/work/api',
    urlTemplate: TEMPLATE,
    oldUrlTemplate: OLD_TEMPLATE,
    ...overrides,
  };
}

describe('fillFileUrlTemplate', () => {
  it('encodes every path segment and keeps the slash separators', () => {
    expect(fillFileUrlTemplate(TEMPLATE, 'src/a b/#1.ts', 12)).toBe(
      'https://github.com/acme/api/blob/abc123/src/a%20b/%231.ts#L12',
    );
  });

  it('does not treat `$` in a path as a replacement pattern', () => {
    expect(fillFileUrlTemplate(TEMPLATE, 'src/$&.ts', 3)).toBe(
      'https://github.com/acme/api/blob/abc123/src/%24%26.ts#L3',
    );
  });

  it('keeps GitLab style URLs untouched around the placeholders', () => {
    const template = 'https://gitlab.com/group/api/-/blob/abc123/{path}#L{line}';
    expect(fillFileUrlTemplate(template, 'a.ts', 1)).toBe('https://gitlab.com/group/api/-/blob/abc123/a.ts#L1');
  });
});

describe('pathLinkText', () => {
  it('builds an absolute path:line for a local folder', () => {
    expect(pathLinkText('/work/api', 'src/a.ts', 5)).toBe('/work/api/src/a.ts:5');
  });

  it('builds a repo-relative path:line for a remote clone', () => {
    expect(pathLinkText(null, 'src/a.ts', 5)).toBe('src/a.ts:5');
  });

  it('leaves the line out for a whole-file link', () => {
    expect(pathLinkText(null, 'src/a.ts', null)).toBe('src/a.ts');
  });
});

describe('linkFor', () => {
  const path = 'src/a.ts';

  it('copies the path:line text in path mode', () => {
    expect(linkFor(context(), path, 'new', 7)).toEqual({ text: '/work/api/src/a.ts:7', href: null });
  });

  it('opens the new template in URL mode', () => {
    expect(linkFor(context({ mode: 'url' }), path, 'new', 7)).toEqual({
      text: '/work/api/src/a.ts:7',
      href: 'https://github.com/acme/api/blob/abc123/src/a.ts#L7',
    });
  });

  it('uses the base template for old lines', () => {
    expect(linkFor(context({ mode: 'url' }), path, 'old', 2).href).toBe(
      'https://github.com/acme/api/blob/base456/src/a.ts#L2',
    );
  });

  it('falls back to a copyable path when the repository has no remote', () => {
    expect(linkFor(context({ mode: 'url', urlTemplate: null, oldUrlTemplate: null }), path, 'new', 2)).toEqual({
      text: '/work/api/src/a.ts:2',
      href: null,
    });
  });
});
