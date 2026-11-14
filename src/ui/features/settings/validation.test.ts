import { describe, expect, it } from 'vitest';
import { validateListEntry } from './validation.ts';

const full = Array.from({ length: 100 }, (_, index) => `user${String(index)}`);

describe('validateListEntry', () => {
  it('trims the entry before saving it', () => {
    expect(validateListEntry('author', '  alice  ', [])).toEqual({ ok: true, value: 'alice' });
    expect(validateListEntry('text', '  unit test  ', [])).toEqual({ ok: true, value: 'unit test' });
  });

  it('rejects a 101st entry, mirroring the server limit', () => {
    expect(validateListEntry('author', 'extra', full)).toEqual({
      ok: false,
      message: 'At most 100 entries.',
    });
  });

  it('rejects text longer than 200 characters and allows exactly 200', () => {
    const tooLong = 'x'.repeat(201);
    expect(validateListEntry('text', tooLong, []).ok).toBe(false);
    expect(validateListEntry('text', 'x'.repeat(200), [])).toEqual({ ok: true, value: 'x'.repeat(200) });
  });

  it('rejects logins with a space or a path traversal fragment', () => {
    expect(validateListEntry('author', 'a b', []).ok).toBe(false);
    expect(validateListEntry('author', '../x', []).ok).toBe(false);
  });

  it('does not store an entry that is only whitespace or a duplicate', () => {
    expect(validateListEntry('text', '   ', []).ok).toBe(false);
    expect(validateListEntry('author', 'alice', ['alice']).ok).toBe(false);
  });
});
