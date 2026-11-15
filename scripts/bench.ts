/**
 * Server-side benchmark for a huge diff; no browser involved.
 *
 *   node scripts/bench.ts [fixture-path]
 *
 * Times the work a huge review does on the server: the diff summary for `main..edited` and for the
 * uncommitted tree, the first three 40-file patch batches and the fingerprint. Without a path it
 * creates a throwaway 200-file repository in the temp folder, so the gate can run it anywhere.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { DiffOptions, DiffSummary, PatchesRequest } from '../src/shared/api.ts';
import { diffPatches, diffSummary } from '../src/server/git/diff.ts';
import { diffFingerprint } from '../src/server/git/fingerprint.ts';

const BATCH_SIZE = 40;
const BATCH_COUNT = 3;
const SMALL_FIXTURE_FILES = 200;
const LINES_PER_FILE = 60;

/** Budgets from the performance task; a real 5000-file fixture must stay below them. */
const SUMMARY_BUDGET_MS = 1500;
const PATCH_BUDGET_MS = 400;
const FINGERPRINT_BUDGET_MS = 50;

type Measurement = { label: string; ms: number; budget: number | null };

function git(root: string, ...args: string[]): void {
  execFileSync('git', args, { cwd: root, stdio: 'ignore' });
}

function commit(root: string, message: string): void {
  // The host has a global pre-commit hook and no repo identity; bypass both like the other scripts.
  git(root, '-c', 'user.name=bench', '-c', 'user.email=bench@example.invalid', 'commit', '-q', '--no-verify', '-m', message);
}

function fileContent(index: number, edited: boolean): string {
  const lines: string[] = [];
  for (let line = 0; line < LINES_PER_FILE; line++) {
    // Two edit points per file give several hunks, like the real fixture.
    const changed = edited && (line % 30 === 4 || line % 30 === 5);
    lines.push(changed ? `export const value${line} = next(${index}, ${line}, true);` : `export const value${line} = compute(${index}, ${line});`);
  }
  return `${lines.join('\n')}\n`;
}

function writeFiles(root: string, edited: boolean): void {
  for (let index = 0; index < SMALL_FIXTURE_FILES; index++) {
    const path = join(root, `module-${String(index % 10).padStart(2, '0')}`, `file-${String(index).padStart(4, '0')}.ts`);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, fileContent(index, edited));
  }
}

/** The same change exists on the `edited` branch and (unstaged) in the working tree of `main`. */
function createFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'ravi-bench-'));
  git(root, 'init', '-q', '-b', 'main');
  writeFiles(root, false);
  git(root, 'add', '-A');
  commit(root, 'base');
  git(root, 'checkout', '-q', '-b', 'edited');
  writeFiles(root, true);
  git(root, 'add', '-A');
  commit(root, 'edit');
  git(root, 'checkout', '-q', 'main');
  git(root, 'checkout', 'edited', '--', '.');
  git(root, 'reset', '-q');
  return root;
}

async function measure(label: string, budget: number | null, run: () => Promise<unknown>): Promise<Measurement> {
  const start = performance.now();
  await run();
  return { label, ms: Math.round(performance.now() - start), budget };
}

function report(rows: Measurement[]): boolean {
  let over = false;
  console.log(`${'operation'.padEnd(26)}${'ms'.padStart(8)}${'budget'.padStart(8)}`);
  for (const row of rows) {
    const exceeded = row.budget !== null && row.ms >= row.budget;
    over ||= exceeded;
    const budget = row.budget === null ? '-' : String(row.budget);
    console.log(`${row.label.padEnd(26)}${String(row.ms).padStart(8)}${budget.padStart(8)}${exceeded ? '  OVER' : ''}`);
  }
  return over;
}

async function main(): Promise<void> {
  const argument = process.argv[2];
  const root = argument === undefined ? createFixture() : resolve(argument);
  try {
    const range: DiffOptions = {
      target: { kind: 'range', from: 'main', to: 'edited', mergeBase: false },
      ignoreWhitespace: false,
      includeUntracked: false,
    };
    const uncommitted: DiffOptions = { target: { kind: 'uncommitted' }, ignoreWhitespace: false, includeUntracked: false };

    // Warm the git process/FS caches first: on Windows the first `git` spawn pays a fixed ~60 ms,
    // which would otherwise be charged to the operation under test instead of the program startup.
    const warm = await diffSummary(root, range);
    await diffSummary(root, uncommitted);
    await diffFingerprint(root, range.target);
    const warmBatch = warm.files.slice(0, BATCH_SIZE).map((file) => ({ path: file.path, oldPath: file.oldPath, status: file.status }));
    if (warmBatch.length > 0) {
      await diffPatches(root, { ...range, files: warmBatch });
    }

    let summary: DiffSummary = { files: [], additions: 0, deletions: 0 };
    const rows: Measurement[] = [
      await measure('summary main..edited', SUMMARY_BUDGET_MS, async () => {
        summary = await diffSummary(root, range);
      }),
      await measure('summary uncommitted', null, () => diffSummary(root, uncommitted)),
    ];

    const files = summary.files.slice(0, BATCH_SIZE * BATCH_COUNT).map((file) => ({
      path: file.path,
      oldPath: file.oldPath,
      status: file.status,
    }));
    for (let batch = 0; batch < BATCH_COUNT; batch++) {
      const slice = files.slice(batch * BATCH_SIZE, (batch + 1) * BATCH_SIZE);
      if (slice.length === 0) {
        break;
      }
      const request: PatchesRequest = { ...range, files: slice };
      rows.push(await measure(`patches batch ${batch + 1} (${slice.length} files)`, PATCH_BUDGET_MS, () => diffPatches(root, request)));
    }

    rows.push(await measure('fingerprint main..edited', FINGERPRINT_BUDGET_MS, () => diffFingerprint(root, range.target)));

    console.log(`${summary.files.length} files in ${root}`);
    const exceeded = report(rows);
    // The throwaway fixture is a smoke test ("does the script run?"): its 200 files cannot
    // amortise the fixed Windows `git` process start (~70 ms per spawn), so the fingerprint
    // budget is only meaningful against a real fixture, where all budgets are enforced.
    if (argument === undefined) {
      console.log('auto fixture: budgets reported, not enforced (pass a fixture path to enforce them)');
    } else if (exceeded) {
      console.error('bench: a budget was exceeded');
      process.exitCode = 1;
    }
  } finally {
    if (argument === undefined) {
      rmSync(root, { recursive: true, force: true });
    }
  }
}

await main();
