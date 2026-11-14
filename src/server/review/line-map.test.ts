import { describe, expect, it } from 'vitest';
import { counterpart } from './line-map.ts';

/**
 * Old file: a b c d e f g h i j k l m n o p q r s t
 * New file: a B B2 c d e f g h i j k l m n o F g h i j
 * Hunk 1 replaces `b` with `B`,`B2`; hunk 2 replaces `f` with `F`.
 */
const PATCH = `diff --git a/f.txt b/f.txt
--- a/f.txt
+++ b/f.txt
@@ -5,4 +5,5 @@
 a
-b
+B
+B2
 c
 d
@@ -15,3 +16,3 @@
 e
-f
+F
 g
`;

describe('counterpart', () => {
  it('maps context lines inside a hunk both ways', () => {
    expect(counterpart(PATCH, 'old', 5)).toBe(5);
    expect(counterpart(PATCH, 'new', 5)).toBe(5);
    expect(counterpart(PATCH, 'old', 7)).toBe(8);
    expect(counterpart(PATCH, 'new', 8)).toBe(7);
    expect(counterpart(PATCH, 'new', 16)).toBe(15);
    expect(counterpart(PATCH, 'old', 15)).toBe(16);
    expect(counterpart(PATCH, 'new', 18)).toBe(17);
    expect(counterpart(PATCH, 'old', 17)).toBe(18);
  });

  it('returns null for added and removed lines', () => {
    // Added on the new side: no old counterpart.
    expect(counterpart(PATCH, 'new', 6)).toBeNull();
    expect(counterpart(PATCH, 'new', 7)).toBeNull();
    expect(counterpart(PATCH, 'new', 17)).toBeNull();
    // Removed on the old side: no new counterpart.
    expect(counterpart(PATCH, 'old', 6)).toBeNull();
    expect(counterpart(PATCH, 'old', 16)).toBeNull();
  });

  it('uses offsets before the first hunk, between hunks and after the last hunk', () => {
    expect(counterpart(PATCH, 'old', 1)).toBe(1);
    expect(counterpart(PATCH, 'old', 4)).toBe(4);
    expect(counterpart(PATCH, 'new', 4)).toBe(4);

    expect(counterpart(PATCH, 'old', 10)).toBe(11);
    expect(counterpart(PATCH, 'old', 14)).toBe(15);
    expect(counterpart(PATCH, 'new', 10)).toBe(9);
    expect(counterpart(PATCH, 'new', 15)).toBe(14);

    expect(counterpart(PATCH, 'old', 18)).toBe(19);
    expect(counterpart(PATCH, 'old', 20)).toBe(21);
    expect(counterpart(PATCH, 'new', 19)).toBe(18);
    expect(counterpart(PATCH, 'new', 21)).toBe(20);
  });

  it('keeps line numbers when the patch changes nothing', () => {
    expect(counterpart('diff --git a/f.txt b/f.txt\n', 'old', 3)).toBe(3);
  });
});
