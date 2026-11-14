import { describe, expect, it } from 'vitest';
import type { ImportedComment, ReviewComment, ReviewDocument, ReviewTarget } from '../../shared/review.ts';
import { fromMarkdown, toMarkdown } from './markdown.ts';

const GITHUB: ReviewTarget = { kind: 'pullRequest', host: 'github.com', project: 'acme/api', number: 123, forge: 'github' };

function comment(overrides: Partial<ReviewComment> & Pick<ReviewComment, 'id' | 'body'>): ReviewComment {
  return {
    parentId: null,
    path: null,
    side: 'new',
    line: null,
    startLine: null,
    author: null,
    state: 'published',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    codeContext: null,
    outdated: false,
    ...overrides,
  };
}

const pick = (item: ReviewComment | ImportedComment) => ({
  id: item.id,
  parentId: item.parentId,
  path: item.path,
  side: item.side,
  line: item.line,
  startLine: item.startLine,
  body: item.body,
  author: item.author,
});

describe('toMarkdown / fromMarkdown', () => {
  it('round-trips a full review: range, old side, PR comment, summary, reply, odd path and rich body', () => {
    const body = '## Not a heading\n\n```ts\nconst x = 1\n```\n> quoted line\nZażółć gęślą jaźń';
    const doc: ReviewDocument = {
      version: 1,
      target: GITHUB,
      baseSha: '9f1c2a7deadbeef',
      headSha: 'a83e0b1ffff',
      action: 'requestChanges',
      summary: 'Overall: looks good, two issues.',
      comments: [
        comment({
          id: 'c1001',
          path: 'src/auth/login.ts',
          side: 'new',
          line: 45,
          startLine: 42,
          body,
          author: 'alice',
          codeContext: 'console.log("token", token)',
        }),
        comment({
          id: 'c1002',
          parentId: 'c1001',
          path: 'src/auth/login.ts',
          side: 'new',
          line: 45,
          startLine: 42,
          body: 'Agreed.\n\nPlease restore it.',
          author: 'bob',
        }),
        comment({ id: 'c1003', path: 'src/db.ts', side: 'old', line: 10, body: 'Why was the retry removed?', author: 'alice' }),
        comment({ id: 'c1004', body: 'General PR comment, not tied to a file.' }),
        comment({
          id: 'c1005',
          path: 'src/odd name:with colon.ts',
          line: 3,
          body: 'Path with spaces and a colon.',
          author: 'carol',
        }),
      ],
    };

    const markdown = toMarkdown(doc);
    expect(markdown.split('\n')[0]).toBe('# Code review: github.com/acme/api PR #123');
    expect(markdown).toContain('revu-review v1 · base 9f1c2a7 · head a83e0b1 · action: request changes');
    expect(markdown).toContain('## src/auth/login.ts:42-45 (new) · id c1001 · alice');

    const result = fromMarkdown(markdown);
    expect(result.errors).toEqual([]);
    expect(result.document).toEqual({
      version: 1,
      baseSha: '9f1c2a7',
      headSha: 'a83e0b1',
      action: 'requestChanges',
      summary: 'Overall: looks good, two issues.',
    });
    expect(result.comments.map(pick)).toEqual(doc.comments.map(pick));
  });

  it('writes GitLab and local titles and omits unknown header parts', () => {
    const gitlab = toMarkdown({
      version: 1,
      target: { kind: 'pullRequest', host: 'gitlab.com', project: 'acme/api', number: 45, forge: 'gitlab' },
      baseSha: null,
      headSha: null,
      action: null,
      summary: null,
      comments: [],
    });
    expect(gitlab).toContain('# Code review: gitlab.com/acme/api MR !45');
    expect(gitlab).toContain('\nrevu-review v1\n');

    const local = toMarkdown({
      version: 1,
      target: { kind: 'local', repoPath: 'C:/repo', target: 'uncommitted' },
      baseSha: null,
      headSha: null,
      action: null,
      summary: null,
      comments: [],
    });
    expect(local).toContain('# Code review: local C:/repo (uncommitted)');
  });

  it('exports a local draft with its id so a re-import can update it instead of duplicating it', () => {
    const doc: ReviewDocument = {
      version: 1,
      target: { kind: 'local', repoPath: 'C:/repo', target: 'staged' },
      baseSha: null,
      headSha: null,
      action: null,
      summary: null,
      comments: [comment({ id: 'l-abc123', path: 'src/a.ts', line: 5, body: 'hello', state: 'draft' })],
    };

    const markdown = toMarkdown(doc);
    expect(markdown).toContain('## src/a.ts:5 (new) · id l-abc123\n> hello');
    const result = fromMarkdown(markdown);
    expect(result.comments[0]?.id).toBe('l-abc123');
    expect(result.comments[0]?.body).toBe('hello');
  });

  it('round-trips two drafts, a root and its reply, with the same ids', () => {
    const doc: ReviewDocument = {
      version: 1,
      target: { kind: 'local', repoPath: 'C:/repo', target: 'uncommitted' },
      baseSha: null,
      headSha: null,
      action: null,
      summary: null,
      comments: [
        comment({ id: 'l-root', path: 'src/a.ts', line: 3, body: 'draft root', state: 'draft' }),
        comment({ id: 'l-reply', parentId: 'l-root', path: 'src/a.ts', line: 3, body: 'draft reply', state: 'draft' }),
      ],
    };

    const result = fromMarkdown(toMarkdown(doc));
    expect(result.errors).toEqual([]);
    expect(result.comments.map(pick)).toEqual(doc.comments.map(pick));
  });

  it('re-imports an edited export: an edited draft keeps its id and an appended section is new', () => {
    const doc: ReviewDocument = {
      version: 1,
      target: { kind: 'local', repoPath: 'C:/repo', target: 'uncommitted' },
      baseSha: null,
      headSha: null,
      action: null,
      summary: null,
      comments: [comment({ id: 'l-edit', path: 'src/a.ts', line: 5, body: 'old text', state: 'draft' })],
    };

    const edited = toMarkdown(doc)
      .replace('> old text', '> new text')
      .concat('\n## src/b.ts:7 (new)\n> brand new\n');
    const result = fromMarkdown(edited);

    expect(result.errors).toEqual([]);
    expect(result.comments).toHaveLength(2);
    expect(result.comments[0]).toMatchObject({ id: 'l-edit', path: 'src/a.ts', line: 5, body: 'new text' });
    expect(result.comments[1]).toMatchObject({ id: null, path: 'src/b.ts', line: 7, body: 'brand new' });
  });

  it('uses a fence longer than any run of backticks in the code context', () => {
    const doc: ReviewDocument = {
      version: 1,
      target: { kind: 'local', repoPath: 'C:/repo', target: 'uncommitted' },
      baseSha: null,
      headSha: null,
      action: null,
      summary: null,
      comments: [comment({ id: 'x', path: 'src/a.ts', line: 1, body: 'code', codeContext: 'const a = ```;\nconst b = ````;' })],
    };

    const markdown = toMarkdown(doc);
    expect(markdown).toContain(`${'`'.repeat(5)}ts`);
    const result = fromMarkdown(markdown);
    expect(result.errors).toEqual([]);
    expect(result.comments[0]?.body).toBe('code');
  });

  it('imports a hand-written AI-style file: CRLF, no blank lines, missing prefix and one broken heading', () => {
    const lines = [
      '### Code review: github.com/acme/api PR #7   ',
      'revu-review v1 · base 1111111 · head 2222222 · action: approve   ',
      '## src/a.ts:10 (new)   ',
      '> first line',
      '',
      '> second line',
      '## broken heading',
      '> skipped',
      '## PR · id 9 · alice',
      '> done',
    ];
    const result = fromMarkdown(lines.join('\r\n'));

    expect(result.document.action).toBe('approve');
    expect(result.comments).toHaveLength(2);
    expect(result.comments[0]).toMatchObject({
      id: null,
      parentId: null,
      path: 'src/a.ts',
      side: 'new',
      line: 10,
      startLine: null,
      body: 'first line\n\nsecond line',
    });
    expect(result.comments[1]).toMatchObject({ id: '9', author: 'alice', path: null, body: 'done' });
    expect(result.errors).toEqual([{ line: 7, message: 'Cannot read the comment heading' }]);
  });

  it('rejects input over 2 MiB', () => {
    const result = fromMarkdown('x'.repeat(2 * 1024 * 1024 + 1));
    expect(result.comments).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.message).toContain('2 MiB');
  });

  it('imports at most 2000 sections and reports the first ignored one', () => {
    const sections = Array.from({ length: 2001 }, (_, index) => `## src/a.ts:${index + 1} (new)\n> c${index}`);
    const result = fromMarkdown(sections.join('\n'));
    expect(result.comments).toHaveLength(2000);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.line).toBe(2000 * 2 + 1);
  });
});
