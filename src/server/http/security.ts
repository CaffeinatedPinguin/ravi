/**
 * Guards for a localhost server that holds forge tokens and can run git.
 *
 * Threats: any web page the user visits can send requests to 127.0.0.1, and DNS rebinding can
 * make a foreign origin resolve to it. Three independent checks answer that:
 *  1. The Host header must be our own loopback address (defeats DNS rebinding).
 *  2. API calls need the session cookie, which only the CLI-opened URL can set.
 *  3. Mutations need a custom header, which a cross-origin page cannot send without a CORS
 *     preflight that this server never approves.
 */
import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { CSRF_HEADER } from '../../shared/api.ts';
import { HttpError } from './router.ts';

export const SESSION_COOKIE = 'ravi_session';

export type SecurityOptions = {
  token: string;
  /** `host:port` values this server answers to. */
  allowedHosts: string[];
  /** Development only: the Vite dev server proxies API calls, so the cookie handshake is skipped. */
  skipSession: boolean;
};

export function assertAllowedHost(req: IncomingMessage, options: SecurityOptions): void {
  const host = req.headers.host ?? '';
  if (!options.allowedHosts.includes(host)) {
    throw new HttpError(403, 'Unexpected Host header');
  }
}

export function assertApiAccess(req: IncomingMessage, options: SecurityOptions): void {
  if (!options.skipSession && !tokensMatch(readCookie(req, SESSION_COOKIE), options.token)) {
    throw new HttpError(401, 'No session. Start ravi from the terminal to open an authorised tab.');
  }
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers[CSRF_HEADER] !== '1') {
    throw new HttpError(403, `Missing ${CSRF_HEADER} header`);
  }
}

export function tokensMatch(candidate: string | undefined | null, token: string): boolean {
  if (candidate === undefined || candidate === null) {
    return false;
  }
  const left = Buffer.from(candidate);
  const right = Buffer.from(token);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict`;
}

function readCookie(req: IncomingMessage, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) {
      return value.join('=');
    }
  }
  return undefined;
}
