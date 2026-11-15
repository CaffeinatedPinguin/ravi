import { describe, expect, it } from 'vitest';
import { initialBaseBranch, validateBaseBranch, validateListEntry } from './validation.ts';

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

describe('validateBaseBranch', () => {
  it('trims and accepts ordinary branch names', () => {
    expect(validateBaseBranch('main')).toEqual({ ok: true, value: 'main' });
    expect(validateBaseBranch('release/1.2')).toEqual({ ok: true, value: 'release/1.2' });
    expect(validateBaseBranch('  main  ')).toEqual({ ok: true, value: 'main' });
  });

  it('rejects names git would treat as options or invalid refs', () => {
    for (const raw of ['-x', 'a b', 'a..b', 'a:b', 'a*', '']) {
      expect(validateBaseBranch(raw).ok).toBe(false);
    }
  });

  it('rejects a name longer than 200 characters', () => {
    expect(validateBaseBranch('x'.repeat(201)).ok).toBe(false);
    expect(validateBaseBranch('x'.repeat(200)).ok).toBe(true);
  });
});

describe('initialBaseBranch', () => {
  it('uses the configured branch only when the repository has it', () => {
    expect(initialBaseBranch('develop', 'main', ['main', 'develop'])).toBe('develop');
    expect(initialBaseBranch('missing', 'main', ['main', 'develop'])).toBe('main');
  });

  it('falls back to the default branch and then to null', () => {
    expect(initialBaseBranch(null, 'main', ['main'])).toBe('main');
    expect(initialBaseBranch(null, null, ['main'])).toBeNull();
    expect(initialBaseBranch('missing', null, [])).toBeNull();
  });
});
