import { describe, expect, it } from 'vitest';
import { e2eForgeOverride, parseForgeOverride } from './e2e-override.ts';

describe('e2eForgeOverride', () => {
  it('is inactive without REVU_E2E=1', () => {
    expect(e2eForgeOverride({ REVU_E2E_FORGE: 'http://127.0.0.1:43210' })).toBeNull();
    expect(e2eForgeOverride({})).toBeNull();
  });

  it('is inactive without an address even when the flag is set', () => {
    expect(e2eForgeOverride({ REVU_E2E: '1' })).toBeNull();
  });

  it('accepts a loopback address when the harness flag is set', () => {
    expect(e2eForgeOverride({ REVU_E2E: '1', REVU_E2E_FORGE: 'http://127.0.0.1:43210' })).toEqual({
      apiUrl: 'http://127.0.0.1:43210',
      webUrl: 'http://127.0.0.1:43210',
    });
  });
});

describe('parseForgeOverride', () => {
  it('rejects every address that is not a loopback http URL', () => {
    const rejected = [
      'http://evil.com',
      'https://127.0.0.1',
      'http://127.0.0.1.evil.com',
      'http://localhost:1',
      'http://127.0.0.1:43210/api',
      'not a url',
    ];
    for (const value of rejected) {
      expect(() => parseForgeOverride(value), value).toThrow(/127\.0\.0\.1/);
    }
  });
});
