import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import { CSRF_HEADER } from '../../shared/api.ts';
import { assertApiAccess, SESSION_COOKIE, sessionCookie } from './security.ts';

/**
 * Behaviour proof for the renamed session cookie and CSRF header: the guard must read the cookie
 * the handshake writes and require the header the UI sends, using the new names end to end.
 */
const options = { token: 'session-token', allowedHosts: ['127.0.0.1:4783'], skipSession: false };

function request(method: string, headers: Record<string, string> = {}): IncomingMessage {
  return { method, headers: { host: '127.0.0.1:4783', ...headers } } as unknown as IncomingMessage;
}

describe('session cookie and CSRF header', () => {
  it('uses the ravi names', () => {
    expect(CSRF_HEADER).toBe('x-ravi');
    expect(SESSION_COOKIE).toBe('ravi_session');
    expect(sessionCookie('token')).toContain('ravi_session=token');
  });

  it('accepts the handshake cookie together with the mutation header', () => {
    const req = request('POST', { cookie: 'ravi_session=session-token', 'x-ravi': '1' });
    expect(() => assertApiAccess(req, options)).not.toThrow();
  });

  it('rejects a mutation without the CSRF header and a call without the session cookie', () => {
    expect(() => assertApiAccess(request('POST', { cookie: 'ravi_session=session-token' }), options)).toThrow(
      /Missing x-ravi header/,
    );
    expect(() => assertApiAccess(request('POST', { 'x-ravi': '1' }), options)).toThrow(/No session/);
  });
});
