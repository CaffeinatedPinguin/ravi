/**
 * Maps a line of one file version to the same line on the other side of a unified patch.
 *
 * A forge needs both the old and the new line of an inline comment: a context line exists in both
 * versions, while an added/removed line exists only on one side. Git's hunk headers give enough
 * information to derive the counter-lines for unchanged regions, including the lines before the
 * first hunk, between hunks and after the last one (those are plain offset arithmetic because no
 * change touches them).
 */
import type { CommentSide } from '../../shared/review.ts';

type Range = { start: number; count: number };

type Hunk = {
  old: Range;
  new: Range;
  /** Context lines only: the pairs that exist on both sides of the change. */
  oldToNew: Map<number, number>;
  newToOld: Map<number, number>;
};

/** `@@ -oldStart,oldCount +newStart,newCount @@`; a missing count means one line. */
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function counterpart(patch: string, side: CommentSide, line: number): number | null {
  const hunks = parseHunks(patch);
  // No hunks means no line changed, so line numbers are identical on both sides.
  if (hunks.length === 0) {
    return line;
  }

  for (const hunk of hunks) {
    const range = side === 'old' ? hunk.old : hunk.new;
    if (range.count > 0 && line >= range.start && line < range.start + range.count) {
      // Inside a hunk only context lines exist on both sides; an added/removed line has no pair.
      const pairs = side === 'old' ? hunk.oldToNew : hunk.newToOld;
      return pairs.get(line) ?? null;
    }
  }

  return line + offsetOutside(hunks, side, line);
}

function parseHunks(patch: string): Hunk[] {
  const hunks: Hunk[] = [];
  let current: Hunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const line of patch.split('\n')) {
    const header = HUNK_HEADER.exec(line);
    if (header !== null) {
      current = {
        old: { start: Number(header[1]), count: header[2] === undefined ? 1 : Number(header[2]) },
        new: { start: Number(header[3]), count: header[4] === undefined ? 1 : Number(header[4]) },
        oldToNew: new Map(),
        newToOld: new Map(),
      };
      hunks.push(current);
      oldLine = current.old.start;
      newLine = current.new.start;
      continue;
    }
    if (current === null || line.startsWith('\\')) {
      continue;
    }

    const marker = line.charAt(0);
    if (marker === '-') {
      oldLine += 1;
    } else if (marker === '+') {
      newLine += 1;
    } else if (marker === ' ') {
      current.oldToNew.set(oldLine, newLine);
      current.newToOld.set(newLine, oldLine);
      oldLine += 1;
      newLine += 1;
    } else {
      // A blank line or the next file header closes the hunk body.
      current = null;
    }
  }

  return hunks;
}

/**
 * The unchanged lines outside every hunk all get the same offset: the distance between the two
 * sides at the nearest hunk boundary. For a zero-count hunk git names the line *before* the change,
 * hence the `+1`.
 */
function offsetOutside(hunks: Hunk[], side: CommentSide, line: number): number {
  for (const hunk of hunks) {
    const from = side === 'old' ? hunk.old : hunk.new;
    const to = side === 'old' ? hunk.new : hunk.old;
    if (line < end(from)) {
      return effectiveStart(to) - effectiveStart(from);
    }
  }
  const last = hunks[hunks.length - 1];
  if (last === undefined) {
    return 0;
  }
  const from = side === 'old' ? last.old : last.new;
  const to = side === 'old' ? last.new : last.old;
  return end(to) - end(from);
}

/** First line after the hunk on this side; a zero count names the line before the change. */
function end(range: Range): number {
  return range.count === 0 ? range.start + 1 : range.start + range.count;
}

/** First unchanged line of the hunk on this side (the line after it for a zero count). */
function effectiveStart(range: Range): number {
  return range.count === 0 ? range.start + 1 : range.start;
}
