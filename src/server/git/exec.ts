/**
 * The single place that spawns `git`. Arguments are always an array (no shell), output is
 * collected in memory, and the number of concurrent processes is capped so that a burst of UI
 * requests on a huge diff cannot fork-bomb the machine.
 */
import { spawn } from 'node:child_process';

const MAX_CONCURRENT = 6;
const MAX_OUTPUT_BYTES = 512 * 1024 * 1024;

/** Applied to every call so that output is stable regardless of the user's git configuration. */
const STABLE_CONFIG = ['-c', 'core.quotePath=false', '-c', 'color.ui=false'];

export class GitError extends Error {
  readonly exitCode: number | null;

  constructor(args: string[], exitCode: number | null, stderr: string) {
    super(`git ${args.join(' ')} failed${exitCode === null ? '' : ` (${exitCode})`}: ${stderr.trim()}`);
    this.exitCode = exitCode;
  }
}

export type GitOptions = {
  /** Exit codes that count as success. `git diff --no-index` returns 1 when files differ. */
  okExitCodes?: number[];
};

let running = 0;
const waiting: Array<() => void> = [];

export async function git(cwd: string, args: string[], options: GitOptions = {}): Promise<Buffer> {
  await acquire();
  try {
    return await runGit(cwd, args, options.okExitCodes ?? [0]);
  } finally {
    release();
  }
}

export async function gitText(cwd: string, args: string[], options: GitOptions = {}): Promise<string> {
  return (await git(cwd, args, options)).toString('utf8');
}

function runGit(cwd: string, args: string[], okExitCodes: number[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', [...STABLE_CONFIG, ...args], { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let size = 0;
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_OUTPUT_BYTES) {
        child.kill();
        reject(new GitError(args, null, 'output too large'));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', (error) => reject(new GitError(args, null, error.message)));
    child.on('close', (code) => {
      if (code !== null && okExitCodes.includes(code)) {
        resolve(Buffer.concat(stdout));
      } else {
        reject(new GitError(args, code, Buffer.concat(stderr).toString('utf8')));
      }
    });
  });
}

function acquire(): Promise<void> {
  if (running < MAX_CONCURRENT) {
    running += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiting.push(resolve));
}

function release(): void {
  const next = waiting.shift();
  if (next) {
    // The slot is handed over directly, so `running` stays unchanged.
    next();
  } else {
    running -= 1;
  }
}
