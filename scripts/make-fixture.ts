/**
 * Creates a git repository with a very large uncommitted change, for performance checks:
 *   node scripts/make-fixture.ts [files=5000] [target=.revu-dev/fixture]
 * Every file gets edits in a few places, so the diff has several hunks per file.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const fileCount = Number(process.argv[2] ?? 5000);
const target = resolve(process.argv[3] ?? '.revu-dev/fixture');
const LINES_PER_FILE = 120;

const git = (...args: string[]) => execFileSync('git', args, { cwd: target, stdio: 'ignore' });

function fileContent(index: number, edited: boolean): string {
  const lines: string[] = [];
  for (let line = 0; line < LINES_PER_FILE; line++) {
    // Edit three separate regions so each file produces several hunks with hidden context between them.
    const changed = edited && (line % 40 === 7 || line % 40 === 8);
    lines.push(
      changed
        ? `export const value${line} = computeNext(${index}, ${line}, { edited: true });`
        : `export const value${line} = compute(${index}, ${line});`,
    );
  }
  return `${lines.join('\n')}\n`;
}

function filePath(index: number): string {
  return join(`module-${String(index % 50).padStart(2, '0')}`, `feature-${String(index % 7)}`, `file-${String(index).padStart(5, '0')}.ts`);
}

function writeAll(edited: boolean): void {
  for (let index = 0; index < fileCount; index++) {
    const path = join(target, filePath(index));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, fileContent(index, edited));
  }
}

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
git('init', '-q', '-b', 'main');
writeAll(false);
git('add', '-A');
const commit = (message: string) =>
  git('-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-q', '--no-verify', '-m', message);
commit('base');

// The same change exists twice: committed on `edited` (the pull request case, `main..edited`)
// and uncommitted in the working tree of `main` (the local review case).
git('checkout', '-q', '-b', 'edited');
writeAll(true);
git('add', '-A');
commit('edit');
git('checkout', '-q', 'main');
git('checkout', 'edited', '--', '.');
git('reset', '-q');

console.log(`${fileCount} changed files in ${target} (uncommitted on main, committed on edited)`);
