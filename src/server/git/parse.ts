/** Pure parsers for git output. Kept free of I/O so the tricky formats are unit-tested directly. */
import type { DiffFile, FileStatus } from '../../shared/api.ts';

const STATUS_BY_LETTER: Record<string, FileStatus> = {
  A: 'added',
  M: 'modified',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
  T: 'modified',
};

/**
 * Parses `git diff --raw --numstat -z`.
 *
 * With `-z` git prints all raw records first, then all numstat records, NUL-separated:
 *   raw:      `:100644 100644 <old> <new> M` NUL `path` NUL            (renames: `R90` NUL old NUL new NUL)
 *   numstat:  `12\t3\tpath` NUL                                        (renames: `12\t3\t` NUL old NUL new NUL)
 * Binary files report `-\t-` instead of line counts.
 */
export function parseRawNumstat(output: string): DiffFile[] {
  const tokens = output.split('\0');
  const files = new Map<string, DiffFile>();
  let index = 0;
  const next = () => tokens[index++] ?? '';

  while (index < tokens.length) {
    const token = next();
    if (token === '') {
      continue;
    }
    if (token.startsWith(':')) {
      const letter = token.slice(token.lastIndexOf(' ') + 1).charAt(0);
      const status = STATUS_BY_LETTER[letter] ?? 'modified';
      const first = next();
      const hasTwoPaths = letter === 'R' || letter === 'C';
      const path = hasTwoPaths ? next() : first;
      files.set(path, { path, oldPath: hasTwoPaths ? first : null, status, additions: 0, deletions: 0, binary: false });
      continue;
    }
    const [added = '', deleted = '', inlinePath = ''] = token.split('\t');
    let path = inlinePath;
    if (path === '') {
      next(); // old path, already known from the raw record
      path = next();
    }
    const file = files.get(path);
    if (file) {
      file.binary = added === '-';
      file.additions = file.binary ? 0 : Number(added);
      file.deletions = file.binary ? 0 : Number(deleted);
    }
  }
  return [...files.values()];
}

/**
 * Splits the output of `git diff` (several files) into one patch per file, keyed by the new path
 * (the old path for deletions).
 */
export function splitPatches(output: string): Map<string, string> {
  const patches = new Map<string, string>();
  const starts: number[] = [];
  const marker = /^diff --git /gm;
  for (let match = marker.exec(output); match !== null; match = marker.exec(output)) {
    starts.push(match.index);
  }
  for (const [position, start] of starts.entries()) {
    const patch = output.slice(start, starts[position + 1] ?? output.length);
    const path = patchPath(patch);
    if (path !== null) {
      patches.set(path, patch);
    }
  }
  return patches;
}

function patchPath(patch: string): string | null {
  const hunkStart = patch.indexOf('\n@@ ');
  const header = (hunkStart === -1 ? patch : patch.slice(0, hunkStart)).split('\n');
  const field = (prefix: string) => header.find((line) => line.startsWith(prefix))?.slice(prefix.length);

  const renamedTo = field('rename to ') ?? field('copy to ');
  if (renamedTo !== undefined) {
    return unquote(renamedTo);
  }
  const added = field('+++ ');
  if (added !== undefined && added !== '/dev/null') {
    return stripSidePrefix(added);
  }
  const removed = field('--- ');
  if (removed !== undefined && removed !== '/dev/null') {
    return stripSidePrefix(removed);
  }
  // No ---/+++ lines (binary or mode-only change): `diff --git a/<path> b/<path>` holds the same path twice.
  const sides = (header[0] ?? '').slice('diff --git '.length);
  const pathLength = (sides.length - 5) / 2;
  return Number.isInteger(pathLength) && pathLength > 0 ? sides.slice(2, 2 + pathLength) : null;
}

function stripSidePrefix(value: string): string {
  // Git appends a tab to names that contain spaces, to mark where the name ends.
  const name = unquote(value.replace(/\t$/, ''));
  return name.replace(/^[ab]\//, '');
}

/** Undoes git's C-style quoting, used for paths with quotes, backslashes or control characters. */
function unquote(value: string): string {
  if (!value.startsWith('"') || !value.endsWith('"')) {
    return value;
  }
  const bytes: number[] = [];
  const inner = value.slice(1, -1);
  const simple: Record<string, number> = { n: 10, t: 9, r: 13, '"': 34, '\\': 92 };
  for (let index = 0; index < inner.length; index++) {
    const char = inner.charAt(index);
    if (char !== '\\') {
      bytes.push(...Buffer.from(char, 'utf8'));
      continue;
    }
    const octal = /^[0-7]{3}/.exec(inner.slice(index + 1));
    if (octal) {
      bytes.push(Number.parseInt(octal[0], 8));
      index += 3;
    } else {
      index += 1;
      bytes.push(simple[inner.charAt(index)] ?? inner.charCodeAt(index));
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

/**
 * Orders paths the way a file tree shows them: inside every folder, sub-folders come before files.
 * The diff and the tree use the same order, so scrolling one walks the other top to bottom.
 */
export function compareTreeOrder(left: string, right: string): number {
  const leftParts = left.split('/');
  const rightParts = right.split('/');
  const shared = Math.min(leftParts.length, rightParts.length);
  for (let index = 0; index < shared; index++) {
    const leftPart = leftParts[index] ?? '';
    const rightPart = rightParts[index] ?? '';
    const leftIsFolder = index < leftParts.length - 1;
    const rightIsFolder = index < rightParts.length - 1;
    if (leftIsFolder !== rightIsFolder) {
      return leftIsFolder ? -1 : 1;
    }
    if (leftPart !== rightPart) {
      return leftPart < rightPart ? -1 : 1;
    }
  }
  return leftParts.length - rightParts.length;
}
