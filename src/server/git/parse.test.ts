import { describe, expect, it } from 'vitest';
import { compareTreeOrder, parseRawNumstat, splitPatches } from './parse.ts';

describe('parseRawNumstat', () => {
  it('joins raw status with numstat counts, including renames and binaries', () => {
    const output = [
      ':100644 100644 aaa bbb M', 'src/a.ts',
      ':100644 100644 aaa bbb R090', 'old name.ts', 'new name.ts',
      ':000000 100644 000 ccc A', 'logo.png',
      ':100644 000000 ddd 000 D', 'gone.txt',
      '10\t2\tsrc/a.ts',
      '3\t1\t', 'old name.ts', 'new name.ts',
      '-\t-\tlogo.png',
      '0\t7\tgone.txt',
      '',
    ].join('\0');

    expect(parseRawNumstat(output)).toEqual([
      { path: 'src/a.ts', oldPath: null, status: 'modified', additions: 10, deletions: 2, binary: false },
      { path: 'new name.ts', oldPath: 'old name.ts', status: 'renamed', additions: 3, deletions: 1, binary: false },
      { path: 'logo.png', oldPath: null, status: 'added', additions: 0, deletions: 0, binary: true },
      { path: 'gone.txt', oldPath: null, status: 'deleted', additions: 0, deletions: 7, binary: false },
    ]);
  });
});

describe('splitPatches', () => {
  it('keys each patch by its new path, or the old path for a deletion', () => {
    const output = [
      'diff --git a/src/a.ts b/src/a.ts',
      'index 1..2 100644',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1 +1 @@',
      '-old',
      '+new',
      'diff --git a/gone.txt b/gone.txt',
      'deleted file mode 100644',
      '--- a/gone.txt',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-bye',
      'diff --git a/old name.ts b/new name.ts',
      'similarity index 90%',
      'rename from old name.ts',
      'rename to new name.ts',
      'diff --git a/img/logo.png b/img/logo.png',
      'index 1..2 100644',
      'Binary files a/img/logo.png and b/img/logo.png differ',
      '',
    ].join('\n');

    const patches = splitPatches(output);

    expect([...patches.keys()]).toEqual(['src/a.ts', 'gone.txt', 'new name.ts', 'img/logo.png']);
    expect(patches.get('src/a.ts')).toContain('+new');
    expect(patches.get('src/a.ts')).not.toContain('gone.txt');
  });

  it('reads names with spaces and quoted names', () => {
    const output = [
      'diff --git a/with space.txt b/with space.txt',
      '--- a/with space.txt\t',
      '+++ b/with space.txt\t',
      '@@ -1 +1 @@',
      '-a',
      '+b',
      'diff --git "a/quo\\"te.txt" "b/quo\\"te.txt"',
      '--- "a/quo\\"te.txt"',
      '+++ "b/quo\\"te.txt"',
      '@@ -1 +1 @@',
      '-a',
      '+b',
      '',
    ].join('\n');

    expect([...splitPatches(output).keys()]).toEqual(['with space.txt', 'quo"te.txt']);
  });

  it('does not treat a diff line inside file content as a new file', () => {
    const output = ['diff --git a/notes.md b/notes.md', '--- a/notes.md', '+++ b/notes.md', '@@ -1 +1,2 @@', ' text', '+diff --git a/x b/x', ''].join('\n');

    expect(splitPatches(output).size).toBe(1);
  });
});

describe('compareTreeOrder', () => {
  it('puts folders before files at every level', () => {
    const paths = ['.editorconfig', 'src/z.ts', 'README.md', 'src/app/b.ts', 'docs/a.md', 'src/a.ts'];

    expect(paths.sort(compareTreeOrder)).toEqual(['docs/a.md', 'src/app/b.ts', 'src/a.ts', 'src/z.ts', '.editorconfig', 'README.md']);
  });
});
