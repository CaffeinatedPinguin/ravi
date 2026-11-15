import { describe, expect, it } from 'vitest';
import { HttpError } from '../http/router.ts';
import { pickFolder } from './fs.ts';
import type { PickFolderResult, PickFolderRun } from './fs.ts';

type Run = PickFolderRun;

const answered = (stdout: string, code = 0): PickFolderResult => ({ code, stdout, stderr: '' });

async function capture(platform: NodeJS.Platform, result: PickFolderResult): Promise<{ runs: Run[]; path: string | null }> {
  const runs: Run[] = [];
  const path = await pickFolder({
    platform,
    env: {},
    runner: (run) => {
      runs.push(run);
      return Promise.resolve(result);
    },
  });
  return { runs, path };
}

describe('pickFolder', () => {
  it('uses PowerShell with FolderBrowserDialog on Windows', async () => {
    const { runs, path } = await capture('win32', answered('C:\\work\\repo\r\n'));

    expect(path).toBe('C:\\work\\repo');
    expect(runs).toHaveLength(1);
    expect(runs[0]?.command).toBe('powershell');
    expect(runs[0]?.args.slice(0, 3)).toEqual(['-NoProfile', '-STA', '-Command']);
    const script = runs[0]?.args[3] ?? '';
    expect(script).toContain('System.Windows.Forms.FolderBrowserDialog');
    expect(script).toContain('$d.ShowNewFolderButton = $false');
  });

  it('uses osascript with a POSIX path on macOS', async () => {
    const { runs, path } = await capture('darwin', answered('/Users/me/repo\n'));

    expect(path).toBe('/Users/me/repo');
    expect(runs[0]).toEqual({
      command: 'osascript',
      args: ['-e', 'POSIX path of (choose folder)'],
      timeoutMs: 5 * 60 * 1000,
    });
  });

  it('uses zenity with --file-selection --directory on Linux', async () => {
    const { runs, path } = await capture('linux', answered('/home/me/repo\n'));

    expect(path).toBe('/home/me/repo');
    expect(runs[0]?.command).toBe('zenity');
    expect(runs[0]?.args).toEqual(['--file-selection', '--directory']);
  });

  it('falls back to kdialog when zenity is not installed', async () => {
    const runs: Run[] = [];
    const path = await pickFolder({
      platform: 'linux',
      env: {},
      runner: (run) => {
        runs.push(run);
        return Promise.resolve(run.command === 'zenity' ? { code: null, stdout: '', stderr: '', missing: true } : answered('/home/me/repo\n'));
      },
    });

    expect(path).toBe('/home/me/repo');
    expect(runs.map((run) => run.command)).toEqual(['zenity', 'kdialog']);
    expect(runs[1]?.args).toEqual(['--getexistingdirectory']);
  });

  it('answers null when the dialog is cancelled', async () => {
    expect((await capture('win32', answered(''))).path).toBeNull();
    expect((await capture('darwin', answered('', 1))).path).toBeNull();
    expect((await capture('linux', answered('', 1))).path).toBeNull();
  });

  it('answers 409 while another dialog is open', async () => {
    let release: ((result: PickFolderResult) => void) | undefined;
    const pending = new Promise<PickFolderResult>((resolve) => {
      release = resolve;
    });
    const first = pickFolder({ platform: 'linux', env: {}, runner: () => pending });

    const second = await pickFolder({ platform: 'linux', env: {}, runner: () => pending }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(second).toBeInstanceOf(HttpError);
    expect((second as HttpError).status).toBe(409);

    release?.(answered('/home/me/repo\n'));
    await expect(first).resolves.toBe('/home/me/repo');
  });

  it('answers 504 when the dialog misses the five-minute deadline', async () => {
    const error = await pickFolder({
      platform: 'win32',
      env: {},
      runner: () => Promise.resolve({ code: null, stdout: '', stderr: '', timedOut: true }),
    }).then(
      () => null,
      (reason: unknown) => reason,
    );

    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(504);
  });

  it('answers 501 with a hint to paste the path when the tool is missing', async () => {
    const error = await pickFolder({
      platform: 'win32',
      env: {},
      runner: () => Promise.resolve({ code: null, stdout: '', stderr: '', missing: true }),
    }).then(
      () => null,
      (reason: unknown) => reason,
    );

    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(501);
    expect((error as HttpError).message).toContain('Paste path');
  });

  it('answers 501 on Linux when neither zenity nor kdialog is installed', async () => {
    const error = await pickFolder({
      platform: 'linux',
      env: {},
      runner: () => Promise.resolve({ code: null, stdout: '', stderr: '', missing: true }),
    }).then(
      () => null,
      (reason: unknown) => reason,
    );

    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(501);
    expect((error as HttpError).message).toContain('Paste path');
  });

  it('uses the E2E override only when RAVI_E2E=1', async () => {
    const override = await pickFolder({
      platform: 'win32',
      env: { RAVI_E2E: '1', RAVI_E2E_PICK_FOLDER: 'C:\\fixture\\sample-repo' },
      runner: () => Promise.reject(new Error('the runner must not be used in E2E')),
    });
    expect(override).toBe('C:\\fixture\\sample-repo');

    const runs: Run[] = [];
    await pickFolder({
      platform: 'win32',
      env: { RAVI_E2E_PICK_FOLDER: 'C:\\ignored' },
      runner: (run) => {
        runs.push(run);
        return Promise.resolve(answered(''));
      },
    });
    expect(runs).toHaveLength(1);
  });
});
