/**
 * System folder picker.
 *
 * A browser cannot open a native folder dialog for the server, so revu asks the operating system
 * on behalf of the settings screen. Commands are spawned with an argument array (no shell) and the
 * only value that leaves is the path the user picked. The dialog is modal and can stay open for a
 * long time, hence the single-dialog guard and the five-minute limit.
 */
import { spawn } from 'node:child_process';
import { HttpError } from '../http/router.ts';
import type { Router } from '../http/router.ts';

export type PickFolderRun = {
  command: string;
  args: string[];
  timeoutMs: number;
};

export type PickFolderResult = {
  /** Process exit code; null when it never started or was killed. */
  code: number | null;
  stdout: string;
  stderr: string;
  /** The executable does not exist. */
  missing?: boolean;
  /** The five-minute limit killed the dialog. */
  timedOut?: boolean;
};

/** Test seam: production spawns a child process, tests answer immediately. */
export type PickFolderRunner = (run: PickFolderRun) => Promise<PickFolderResult>;

export type PickFolderOptions = {
  platform?: NodeJS.Platform;
  runner?: PickFolderRunner;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
};

export const DIALOG_TIMEOUT_MS = 5 * 60 * 1000;

/** One dialog at a time; the OS dialog is modal and a second request would fight for focus. */
let dialogOpen = false;

const WINDOWS_SCRIPT = [
  'Add-Type -AssemblyName System.Windows.Forms',
  '$d = New-Object System.Windows.Forms.FolderBrowserDialog',
  '$d.ShowNewFolderButton = $false',
  'if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $d.SelectedPath }',
].join('; ');

export async function pickFolder(options: PickFolderOptions = {}): Promise<string | null> {
  const env = options.env ?? process.env;
  // The E2E harness must never open a real dialog; the override is ignored outside REVU_E2E=1.
  if (env.REVU_E2E === '1') {
    const override = (env.REVU_E2E_PICK_FOLDER ?? '').trim();
    if (override !== '') {
      return override;
    }
  }

  if (dialogOpen) {
    throw new HttpError(409, 'A folder dialog is already open');
  }
  dialogOpen = true;
  try {
    return await showDialog(options);
  } finally {
    dialogOpen = false;
  }
}

export function registerFsRoutes(router: Router): void {
  router.post('/api/fs/pick-folder', async () => ({ path: await pickFolder() }));
}

async function showDialog(options: PickFolderOptions): Promise<string | null> {
  const platform = options.platform ?? process.platform;
  const runner = options.runner ?? spawnRunner;
  const timeoutMs = options.timeoutMs ?? DIALOG_TIMEOUT_MS;

  if (platform === 'win32') {
    return interpret(
      await runner({
        command: 'powershell',
        args: ['-NoProfile', '-STA', '-Command', WINDOWS_SCRIPT],
        timeoutMs,
      }),
      'PowerShell folder dialog',
    );
  }
  if (platform === 'darwin') {
    return interpret(
      await runner({ command: 'osascript', args: ['-e', 'POSIX path of (choose folder)'], timeoutMs }),
      'osascript',
    );
  }

  // Linux has no standard dialog; zenity is the GNOME default, kdialog the KDE one.
  const zenity = await runner({ command: 'zenity', args: ['--file-selection', '--directory'], timeoutMs });
  if (!zenity.missing) {
    return interpret(zenity, 'zenity');
  }
  const kdialog = await runner({ command: 'kdialog', args: ['--getexistingdirectory'], timeoutMs });
  if (kdialog.missing) {
    throw new HttpError(
      501,
      'No folder dialog is installed (zenity or kdialog). Use "Paste path" instead.',
    );
  }
  return interpret(kdialog, 'kdialog');
}

/** A cancelled dialog is not an error: both tools exit non-zero and print nothing usable. */
function interpret(result: PickFolderResult, tool: string): string | null {
  if (result.missing) {
    throw new HttpError(501, `${tool} is not installed. Use "Paste path" instead.`);
  }
  if (result.timedOut) {
    throw new HttpError(504, `${tool} did not answer within 5 minutes`);
  }
  const path = result.stdout.trim();
  if (result.code !== 0 || path === '') {
    return null;
  }
  return path;
}

/** Default runner: no shell, output collected in memory, and a hard kill at the deadline. */
const spawnRunner: PickFolderRunner = (run) =>
  new Promise((resolvePromise) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const child = spawn(run.command, run.args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const finish = (value: PickFolderResult): void => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolvePromise(value);
      }
    };
    const timer = setTimeout(() => {
      child.kill();
      finish({ code: null, stdout, stderr, timedOut: true });
    }, run.timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (error: NodeJS.ErrnoException) => {
      finish({ code: null, stdout, stderr, missing: error.code === 'ENOENT' });
    });
    child.on('close', (code) => {
      finish({ code, stdout, stderr });
    });
  });
