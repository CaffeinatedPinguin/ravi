/** Parses the unified diff text of one file into hunks and numbered lines. */

export type DiffLine = {
  type: 'context' | 'add' | 'del';
  /** Line number in the old file; `null` for added lines. */
  oldNo: number | null;
  /** Line number in the new file; `null` for deleted lines. */
  newNo: number | null;
  text: string;
};

export type Hunk = {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  /** Text after the second `@@`, usually the enclosing function. */
  section: string;
  lines: DiffLine[];
};

export type ParsedPatch = {
  hunks: Hunk[];
  /** Git reported a binary change; there are no hunks to show. */
  binary: boolean;
};

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;

export function parsePatch(patch: string): ParsedPatch {
  const hunks: Hunk[] = [];
  let binary = false;
  let current: Hunk | null = null;
  let oldNo = 0;
  let newNo = 0;

  for (const rawLine of patch.split('\n')) {
    // Files with Windows line endings carry the \r into the diff; it is noise when displayed.
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    const header = HUNK_HEADER.exec(line);
    if (header) {
      current = {
        oldStart: Number(header[1]),
        oldLines: header[2] === undefined ? 1 : Number(header[2]),
        newStart: Number(header[3]),
        newLines: header[4] === undefined ? 1 : Number(header[4]),
        section: header[5] ?? '',
        lines: [],
      };
      hunks.push(current);
      oldNo = current.oldStart;
      newNo = current.newStart;
      continue;
    }
    if (current === null) {
      binary ||= line.startsWith('Binary files ') || line === 'GIT binary patch';
      continue;
    }
    const text = line.slice(1);
    switch (line.charAt(0)) {
      case '+':
        current.lines.push({ type: 'add', oldNo: null, newNo: newNo++, text });
        break;
      case '-':
        current.lines.push({ type: 'del', oldNo: oldNo++, newNo: null, text });
        break;
      case ' ':
        current.lines.push({ type: 'context', oldNo: oldNo++, newNo: newNo++, text });
        break;
      default:
        // "\ No newline at end of file" and the empty string after the final newline.
        break;
    }
  }
  return { hunks, binary };
}
