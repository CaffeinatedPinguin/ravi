import { describe, expect, it } from 'vitest';
import { connectedKeys, pathKey } from './scan.ts';

describe('pathKey', () => {
  it('treats slashes, case and a trailing separator as the same folder', () => {
    expect(pathKey('C:\\Work\\App\\')).toBe(pathKey('c:/work/app'));
  });

  it('keeps different folders apart', () => {
    expect(pathKey('/home/me/a')).not.toBe(pathKey('/home/me/ab'));
  });
});

describe('connectedKeys', () => {
  it('lets a scan result match a repository that git reported with forward slashes', () => {
    const connected = connectedKeys(['C:/Users/me/revu']);
    expect(connected.has(pathKey('C:\\Users\\me\\revu'))).toBe(true);
    expect(connected.has(pathKey('C:\\Users\\me\\other'))).toBe(false);
  });
});
