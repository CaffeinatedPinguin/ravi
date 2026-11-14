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

/** Exactly what a git child process gets; captured by tests through `onSpawn`. */
export type SpawnInfo = {
  args: string[];
  env: NodeJS.ProcessEnv;
};

export type GitOptions = {
  /** Exit codes that count as success. `git diff --no-index` returns 1 when files differ. */
  okExitCodes?: number[];
  /** Extra environment variables merged over the process environment (used for clone auth). */
  env?: NodeJS.ProcessEnv;
  /** Test seam: sees the arguments and environment just before spawn, so secrets can be checked. */
  onSpawn?: (info: SpawnInfo) => void;
};

let running = 0;
const waiting: Array<() => void> = [];

export async function git(cwd: string, args: string[], options: GitOptions = {}): Promise<Buffer> {
  await acquire();
  try {
    return await runGit(cwd, args, options);
  } finally {
    release();
  }
}

export async function gitText(cwd: string, args: string[], options: GitOptions = {}): Promise<string> {
  return (await git(cwd, args, options)).toString('utf8');
}

function runGit(cwd: string, args: string[], options: GitOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const fullArgs = [...STABLE_CONFIG, ...args];
    // `GIT_TERMINAL_PROMPT=0` guarantees that a network call can never hang waiting for a password:
    // authentication must come from the clone environment or fail fast.
    const env: NodeJS.ProcessEnv = { ...process.env, ...options.env, GIT_TERMINAL_PROMPT: '0' };
    options.onSpawn?.({ args: fullArgs, env });
    const child = spawn('git', fullArgs, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
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
      if (code !== null && (options.okExitCodes ?? [0]).includes(code)) {
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
