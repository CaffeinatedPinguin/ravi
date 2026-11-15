/**
 * A small git repository for the E2E suite. It is created in the OS temp folder so the tests never
 * touch the user's repositories, and it is deliberately small: a few commits plus uncommitted edits,
 * a rename, a deletion, an untracked file and one long file whose hunks need expanding.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export type Fixture = {
  /** Temporary parent of the repository and the ravi home. */
  root: string;
  repoPath: string;
  /** Fresh `RAVI_HOME`, so the run cannot see the user's settings or tokens. */
  home: string;
  cleanup: () => void;
};

const LONG_LINES = 240;

export function createFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'ravi-e2e-'));
  const repoPath = join(root, 'sample-repo');
  const home = join(root, 'home');
  mkdirSync(repoPath, { recursive: true });
  mkdirSync(home, { recursive: true });
  // The fake forge accepts any token; the real app still reads it only from `.env`.
  writeFileSync(join(home, '.env'), 'GITHUB_TOKEN=e2e-token\n');

  const file = (path: string, content: string): void => {
    mkdirSync(dirname(join(repoPath, path)), { recursive: true });
    writeFileSync(join(repoPath, path), content);
  };
  const appFile = (extra: readonly string[]): string =>
    [
      'export function greet(name: string): string {',
      '  return `Hello, ${name}`;',
      '}',
      '',
      'export const version = 1;',
      ...extra,
      '',
    ].join('\n');
  const longFile = (changed: boolean): string =>
    `${Array.from({ length: LONG_LINES }, (_, index) => {
      const line = index + 1;
      const touched = changed && (line === 4 || line === LONG_LINES - 4);
      return `export const line${line} = ${touched ? `changed(${line})` : String(line)};`;
    }).join('\n')}\n`;
  const git = (...args: string[]): void => {
    execFileSync('git', ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', ...args], {
      cwd: repoPath,
      stdio: 'ignore',
    });
  };
  const commit = (message: string): void => git('commit', '-q', '--no-verify', '-m', message);

  file('README.md', '# sample-repo\n\nA fixture for the ravi end-to-end suite.\n');
  file('src/app.ts', appFile([]));
  file('src/util.ts', 'export function sum(values: number[]): number {\n  return values.reduce((a, b) => a + b, 0);\n}\n');
  file('src/long.ts', longFile(false));
  file('src/gone.ts', 'export const gone = true;\n');
  file('src/old-name.ts', "export const renamed = 'old';\n");
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  commit('base');

  file('README.md', '# sample-repo\n\nA fixture for the ravi end-to-end suite.\n\nMaintained by the tests.\n');
  git('add', '-A');
  commit('docs');

  file('src/app.ts', appFile(["export const extra = 'uncommitted';", 'export const count = 3;', 'export const updated = true;']));
  file('src/long.ts', longFile(true));
  rmSync(join(repoPath, 'src/gone.ts'));
  git('mv', 'src/old-name.ts', 'src/new-name.ts');
  file('src/untracked.ts', 'export const untracked = true;\n');

  return { root, repoPath, home, cleanup: () => removeTree(root) };
}

/**
 * Windows keeps handles on files for a moment after a git or server process exits, so a plain
 * recursive delete fails with EBUSY. Retrying a few times clears that without hiding real errors.
 */
export function removeTree(path: string): void {
  rmSync(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
