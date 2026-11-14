import { describe, expect, it } from 'vitest';
import type { ReviewComment, ReviewDocument, ReviewTarget } from '../../shared/review.ts';
import { toMarkdown } from './markdown.ts';
import { mergeMarkdown } from './merge.ts';

const NOW = '2026-11-14T10:00:00.000Z';
const LOCAL: ReviewTarget = { kind: 'local', repoPath: 'C:/repo', target: 'uncommitted' };

function comment(overrides: Partial<ReviewComment> & Pick<ReviewComment, 'id' | 'body'>): ReviewComment {
  return {
    parentId: null,
    path: 'src/a.ts',
    side: 'new',
    line: 5,
    startLine: null,
    author: null,
    state: 'draft',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    codeContext: null,
    outdated: false,
    ...overrides,
  };
}

function documentOf(comments: ReviewComment[], extra: Partial<ReviewDocument> = {}): ReviewDocument {
  return {
    version: 1,
    target: LOCAL,
    baseSha: null,
    headSha: null,
    action: null,
    summary: null,
    comments,
    ...extra,
  };
}

function sequentialIds(): () => string {
  let next = 0;
  return () => {
    next += 1;
    return `l-new-${next}`;
  };
}

describe('mergeImported', () => {
  it('re-imports an edited export: edited body keeps its id, the new section is added, the reply stays attached', () => {
    const document = documentOf(
      [
        comment({ id: 'l-root', body: 'old text' }),
        comment({ id: 'l-reply', parentId: 'l-root', body: 'agreed' }),
      ],
      { summary: 'Initial note.' },
    );
    const exported = toMarkdown(document)
      .replace('> old text', '> new text')
      .replace('> Initial note.', '> Updated note.')
      .concat('\n## src/b.ts:7 (new)\n> brand new\n');

    const result = mergeMarkdown(exported, {
      document,
      files: [
        { path: 'src/a.ts', oldPath: null },
        { path: 'src/b.ts', oldPath: null },
      ],
      lineCount: () => 20,
      now: NOW,
      createId: sequentialIds(),
    });

    expect(result.report).toMatchObject({ edited: 1, added: 1, skipped: 1 });
    expect(result.report.errors).toEqual([]);

    const root = result.document.comments.find((item) => item.id === 'l-root');
    expect(root).toMatchObject({ body: 'new text', updatedAt: NOW, state: 'draft' });
    expect(result.document.comments.find((item) => item.id === 'l-reply')).toMatchObject({ parentId: 'l-root', body: 'agreed' });
    expect(result.document.comments.find((item) => item.path === 'src/b.ts')).toMatchObject({
      id: 'l-new-1',
      state: 'draft',
      author: null,
      body: 'brand new',
    });
    // The imported summary overrides the document's; no action was imported, so it stays null.
    expect(result.document.summary).toBe('Updated note.');
    expect(result.document.action).toBeNull();
  });

  it('maps a fresh parent id onto its replies when they arrive without ids', () => {
    const markdown = toMarkdown(documentOf([])).concat('\n## src/a.ts:3 (new)\n> parent\n\n### reply\n> child\n');

    const result = mergeMarkdown(markdown, {
      document: documentOf([]),
      files: [{ path: 'src/a.ts', oldPath: null }],
      lineCount: () => 10,
      now: NOW,
      createId: sequentialIds(),
    });

    expect(result.report).toMatchObject({ added: 2, edited: 0, skipped: 0 });
    const parent = result.document.comments.find((item) => item.body === 'parent');
    const reply = result.document.comments.find((item) => item.body === 'child');
    expect(parent?.id).toBe('l-new-1');
    expect(reply).toMatchObject({ id: 'l-new-2', parentId: 'l-new-1' });
  });

  it('reports a path outside the diff and a line past the file end, keeping everything else', () => {
    const document = documentOf([comment({ id: 'l-keep', path: 'src/keep.ts', body: 'kept' })]);
    const markdown = [
      '## src/a.ts:1 (new)',
      '> fine',
      '',
      '## src/missing.ts:1 (new)',
      '> not in the diff',
      '',
      '## src/a.ts:99 (new)',
      '> past the end',
    ].join('\n');

    const result = mergeMarkdown(markdown, {
      document,
      files: [{ path: 'src/a.ts', oldPath: null }],
      lineCount: (path) => (path === 'src/a.ts' ? 5 : null),
      now: NOW,
      createId: sequentialIds(),
    });

    expect(result.report.errors.map((error) => error.line)).toEqual([4, 7]);
    expect(result.report.errors[0]?.message).toContain('src/missing.ts');
    expect(result.report.errors[1]?.message).toContain('99');
    expect(result.report.added).toBe(1);
    expect(result.document.comments.map((item) => item.id)).toContain('l-keep');
    expect(result.document.comments.find((item) => item.body === 'fine')).toMatchObject({ path: 'src/a.ts', line: 1 });
  });
});
