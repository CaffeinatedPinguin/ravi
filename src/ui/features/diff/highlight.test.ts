import { describe, expect, it } from 'vitest';
import { languageForPath } from './highlight.ts';

describe('languageForPath', () => {
  it('maps known extensions and whole file names', () => {
    expect(languageForPath('src/app.ts')).toBe('typescript');
    expect(languageForPath('docker/Dockerfile')).toBe('dockerfile');
  });

  it('returns null for unknown files', () => {
    expect(languageForPath('notes.xyz')).toBeNull();
  });

  // File names come from the reviewed repository, so they must never reach Object.prototype members.
  it.each(['x.constructor', 'x.__proto__', 'x.toString', 'hasOwnProperty'])('returns null for %s', (path) => {
    expect(languageForPath(path)).toBeNull();
  });
});
