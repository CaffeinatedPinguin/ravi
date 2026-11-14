/** Opens a URL in the user's default browser without a shell, so the URL is never interpreted. */
import { spawn } from 'node:child_process';

export function openBrowser(url: string): void {
  const [command, args] = launcher(url);
  const child = spawn(command, args, { stdio: 'ignore', detached: true });
  // A missing launcher (e.g. a headless Linux box) must not crash the server; the URL is printed anyway.
  child.on('error', () => undefined);
  child.unref();
}

function launcher(url: string): [string, string[]] {
  switch (process.platform) {
    case 'win32':
      // `start` would need cmd.exe, which mangles `&` in query strings; this handler takes the URL verbatim.
      return ['rundll32.exe', ['url.dll,FileProtocolHandler', url]];
    case 'darwin':
      return ['open', [url]];
    default:
      return ['xdg-open', [url]];
  }
}
