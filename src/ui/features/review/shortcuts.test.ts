import { describe, expect, it } from 'vitest';
import { LOCAL_REVIEW_SHORTCUTS } from './shortcuts.ts';

describe('LOCAL_REVIEW_SHORTCUTS', () => {
  it('lists every key the local review handles, including the dialog opener', () => {
    const keys = LOCAL_REVIEW_SHORTCUTS.map((shortcut) => shortcut.keys);

    expect(keys).toEqual(expect.arrayContaining(['j / k', 'r', 'c', 'Shift + C', 'Shift + S', 'Shift + I', '?']));
  });

  it('keeps the keys unique so the dialog can use them as stable ids', () => {
    const keys = LOCAL_REVIEW_SHORTCUTS.map((shortcut) => shortcut.keys);

    expect(new Set(keys).size).toBe(keys.length);
  });
});
