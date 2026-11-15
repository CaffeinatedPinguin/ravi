/**
 * Test-only forge host override for the browser E2E harness.
 *
 * The Playwright suite drives the real GitHub strategy against a fake API on this machine. That is
 * safe because both variables are ignored unless `RAVI_E2E=1` (set only by `e2e/support/app.ts`)
 * and the address must be a literal loopback http URL: a token can never leave the machine, and a
 * normal `ravi` process behaves exactly as before. Anything else is refused loudly.
 */
export type ForgeUrlOverride = { apiUrl: string; webUrl: string };

const LOOPBACK = '127.0.0.1';

/** The override for this process, or `null` when the E2E harness did not ask for one. */
export function e2eForgeOverride(env: NodeJS.ProcessEnv = process.env): ForgeUrlOverride | null {
  if (env.RAVI_E2E !== '1') {
    return null;
  }
  const value = env.RAVI_E2E_FORGE;
  return value === undefined || value === '' ? null : parseForgeOverride(value);
}

/** Accepts only `http://127.0.0.1:<port>`; every forged request carries the token. */
export function parseForgeOverride(value: string): ForgeUrlOverride {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('RAVI_E2E_FORGE must be an http://127.0.0.1:<port> URL');
  }
  const loopback = url.protocol === 'http:' && url.hostname === LOOPBACK && url.port !== '';
  if (
    !loopback ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== '' ||
    url.username !== '' ||
    url.password !== ''
  ) {
    throw new Error('RAVI_E2E_FORGE must be an http://127.0.0.1:<port> URL');
  }
  const base = `${url.protocol}//${LOOPBACK}:${url.port}`;
  return { apiUrl: base, webUrl: base };
}
