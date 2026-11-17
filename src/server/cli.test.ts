import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { run } from './cli.ts';

const home = mkdtempSync(join(tmpdir(), 'ravi-cli-'));

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
});

describe('run --help', () => {
  it('prints the data folder taken from RAVI_HOME', async () => {
    const previous = process.env.RAVI_HOME;
    // `--help` is answered before the server starts, so the test never needs a port or a token.
    process.env.RAVI_HOME = home;
    const printed: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      printed.push(args.map(String).join(' '));
    });
    try {
      await run(['--help'], { assets: null });
    } finally {
      if (previous === undefined) {
        delete process.env.RAVI_HOME;
      } else {
        process.env.RAVI_HOME = previous;
      }
    }

    const output = printed.join('\n');
    expect(output).toContain(home);
    expect(output).toContain('RAVI_HOME');
  });
});
