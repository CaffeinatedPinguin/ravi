/**
 * Markdown v1, the exchange format between ravi and an AI (or a human).
 *
 * The whole point is a text that explains itself: an agent that has never seen ravi must be able to
 * read a review and add a comment in the same shape. That is why the header contains the rules, why
 * every comment body line is quoted (so arbitrary Markdown cannot accidentally start a section) and
 * why comments and replies are plain `##` / `###` headings.
 *
 * Both functions are pure: no file system, no clock, no ids assigned.
 */
import { Buffer } from 'node:buffer';
import type {
  ImportResult,
  ImportedComment,
  ReviewAction,
  ReviewComment,
  ReviewDocument,
  ReviewTarget,
} from '../../shared/review.ts';

/** Keep a pasted export from exhausting memory; 2 MiB is far above a real review. */
const MAX_INPUT_BYTES = 2 * 1024 * 1024;
/** One review with more comments than this is almost certainly a mistake or an attack. */
const MAX_SECTIONS = 2000;

const FORMAT_LINES = [
  'Format: each "##" section is one comment. "path:line (new|old)" is the line in',
  'the new or old version of the file; the quoted code is context; the comment',
  'is the "> " text. "## PR" = comment on the whole PR, "### reply" = reply.',
  'Add sections in the same form to create new comments.',
];

const ACTION_LABELS: Record<ReviewAction, string> = {
  comment: 'comment',
  approve: 'approve',
  requestChanges: 'request changes',
};

/** Language hint per extension; unknown extensions get none, as the rules allow. */
const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: 'ts',
  tsx: 'tsx',
  js: 'js',
  jsx: 'jsx',
  mjs: 'js',
  cjs: 'js',
  json: 'json',
  css: 'css',
  scss: 'scss',
  html: 'html',
  htm: 'html',
  md: 'md',
  yml: 'yaml',
  yaml: 'yaml',
  sh: 'bash',
  bash: 'bash',
  py: 'python',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  rb: 'ruby',
  php: 'php',
  cs: 'csharp',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  hpp: 'cpp',
  sql: 'sql',
  toml: 'toml',
  xml: 'xml',
  swift: 'swift',
};

/** A `##` or `###` block before it is interpreted. */
type RawSection = { reply: boolean; heading: string; line: number; lines: string[] };

type HeaderParts = {
  baseSha: string | null;
  headSha: string | null;
  action: ReviewAction | null;
};

export function toMarkdown(doc: ReviewDocument): string {
  const lines = [`# Code review: ${title(doc.target)}`, headerLine(doc), ...FORMAT_LINES];
  if (doc.summary !== null) {
    lines.push('', '## Summary', ...quoteBody(doc.summary));
  }
  for (const entry of orderedComments(doc.comments)) {
    lines.push('', ...sectionLines(entry.comment, entry.reply));
  }
  return `${lines.join('\n')}\n`;
}

export function fromMarkdown(text: string): ImportResult {
  const result: ImportResult = {
    document: { version: 1, baseSha: null, headSha: null, action: null, summary: null },
    comments: [],
    errors: [],
  };
  if (Buffer.byteLength(text, 'utf8') > MAX_INPUT_BYTES) {
    result.errors.push({ line: 1, message: 'Input is larger than 2 MiB' });
    return result;
  }

  // Normalising CRLF and lone CR here keeps every later line number equal to the user's editor.
  const lines = text.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n');
  const { sections, header } = collectSections(lines);
  result.document.baseSha = header.baseSha;
  result.document.headSha = header.headSha;
  result.document.action = header.action;

  if (sections.length > MAX_SECTIONS) {
    const ignored = sections[MAX_SECTIONS];
    if (ignored !== undefined) {
      result.errors.push({ line: ignored.line, message: `Only the first ${MAX_SECTIONS} sections are imported` });
    }
  }

  let lastComment: ImportedComment | null = null;
  for (const section of sections.slice(0, MAX_SECTIONS)) {
    if (section.reply) {
      const reply = parseReplyHeading(section.heading);
      if (reply === null) {
        result.errors.push({ line: section.line, message: 'Cannot read the reply heading' });
        continue;
      }
      if (lastComment === null) {
        result.errors.push({ line: section.line, message: 'Reply without a comment above it' });
        continue;
      }
      result.comments.push({
        id: reply.id,
        parentId: lastComment.id,
        path: lastComment.path,
        side: lastComment.side,
        line: lastComment.line,
        startLine: lastComment.startLine,
        // A hand-written or older export may quote the code context above the reply; it is context.
        body: parseContent(section.lines).body,
        author: reply.author,
      });
      continue;
    }

    if (section.heading === 'Summary') {
      result.document.summary = parseBody(section.lines);
      continue;
    }

    const comment = parseCommentHeading(section.heading);
    if (comment === null) {
      result.errors.push({ line: section.line, message: 'Cannot read the comment heading' });
      continue;
    }
    const content = parseContent(section.lines);
    const imported: ImportedComment = {
      id: comment.id,
      parentId: null,
      path: comment.path,
      side: comment.side,
      line: comment.line,
      startLine: comment.startLine,
      body: content.body,
      author: comment.author,
    };
    result.comments.push(imported);
    lastComment = imported;
  }
  return result;
}

// ── Writing ─────────────────────────────────────────────────────────────────

function title(target: ReviewTarget): string {
  if (target.kind === 'pullRequest') {
    return target.forge === 'gitlab'
      ? `${target.host}/${target.project} MR !${target.number}`
      : `${target.host}/${target.project} PR #${target.number}`;
  }
  return `local ${target.repoPath} (${target.target})`;
}

function headerLine(doc: ReviewDocument): string {
  const parts = ['ravi-review v1'];
  if (doc.baseSha !== null && doc.baseSha !== '') {
    parts.push(`base ${shortSha(doc.baseSha)}`);
  }
  if (doc.headSha !== null && doc.headSha !== '') {
    parts.push(`head ${shortSha(doc.headSha)}`);
  }
  if (doc.action !== null) {
    parts.push(`action: ${ACTION_LABELS[doc.action]}`);
  }
  return parts.join(' · ');
}

/** Only the first seven characters travel; a reader can always ask git for the full hash. */
function shortSha(sha: string): string {
  const trimmed = sha.trim();
  return trimmed.length > 7 ? trimmed.slice(0, 7) : trimmed;
}

/**
 * Roots in document order, each followed by its replies. A comment whose parent is missing is
 * written as a root rather than dropped, so a damaged document still exports everything.
 */
function orderedComments(comments: ReviewComment[]): Array<{ comment: ReviewComment; reply: boolean }> {
  const known = new Set(comments.map((comment) => comment.id));
  const children = new Map<string, ReviewComment[]>();
  for (const comment of comments) {
    if (comment.parentId !== null && known.has(comment.parentId)) {
      const list = children.get(comment.parentId) ?? [];
      list.push(comment);
      children.set(comment.parentId, list);
    }
  }

  const ordered: Array<{ comment: ReviewComment; reply: boolean }> = [];
  const emitted = new Set<string>();
  const emit = (comment: ReviewComment, reply: boolean): void => {
    if (emitted.has(comment.id)) {
      return;
    }
    emitted.add(comment.id);
    ordered.push({ comment, reply });
    for (const child of children.get(comment.id) ?? []) {
      emit(child, true);
    }
  };

  for (const comment of comments) {
    if (comment.parentId === null || !known.has(comment.parentId)) {
      emit(comment, false);
    }
  }
  // Orphans of a cycle still deserve a section.
  for (const comment of comments) {
    emit(comment, comment.parentId !== null);
  }
  return ordered;
}

function sectionLines(comment: ReviewComment, reply: boolean): string[] {
  const heading = reply ? `### reply${suffix(comment)}` : `## ${location(comment)}${suffix(comment)}`;
  // The quoted code belongs to the comment's location, not to the conversation; a reply has none.
  return [heading, ...(reply ? [] : codeLines(comment)), ...quoteBody(comment.body)];
}

function location(comment: ReviewComment): string {
  if (comment.path === null) {
    return 'PR';
  }
  // A file comment without a line cannot be expressed; line 1 keeps the export importable.
  const line = comment.line ?? 1;
  const range = comment.startLine === null ? `${line}` : `${comment.startLine}-${line}`;
  return `${comment.path}:${range} (${comment.side})`;
}

/**
 * Every comment that has an id writes it, drafts included. The main workflow is copy → edit in an
 * AI/human → import back: without the id an edited draft would return as a new comment and the
 * review would fill with duplicates. Ids are opaque to the reader, so showing a local `l-...` is
 * harmless; `author` is only written when it is known.
 */
function suffix(comment: ReviewComment): string {
  let text = '';
  if (comment.id !== '') {
    text += ` · id ${comment.id}`;
  }
  if (comment.author !== null && comment.author !== '') {
    text += ` · ${comment.author}`;
  }
  return text;
}

function codeLines(comment: ReviewComment): string[] {
  if (comment.codeContext === null) {
    return [];
  }
  const code = comment.codeContext.replace(/\n$/, '');
  const ticks = Math.max(3, longestBacktickRun(code) + 1);
  const fence = '`'.repeat(ticks);
  const language = languageFor(comment.path);
  return [`${fence}${language}`, ...code.split('\n'), fence];
}

function languageFor(path: string | null): string {
  if (path === null) {
    return '';
  }
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  const name = path.slice(slash + 1);
  const dot = name.lastIndexOf('.');
  if (dot < 0) {
    return '';
  }
  return LANGUAGE_BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? '';
}

function longestBacktickRun(text: string): number {
  let longest = 0;
  let current = 0;
  for (const char of text) {
    if (char === '`') {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return longest;
}

/** Quoting every line keeps headings, fences and quotes inside the body unambiguous. */
function quoteBody(body: string): string[] {
  return body.split('\n').map((line) => (line === '' ? '>' : `> ${line}`));
}

// ── Reading ─────────────────────────────────────────────────────────────────

function collectSections(lines: string[]): { sections: RawSection[]; header: HeaderParts } {
  const sections: RawSection[] = [];
  const header: HeaderParts = { baseSha: null, headSha: null, action: null };
  let current: RawSection | null = null;
  let fence = 0;

  for (const [index, raw] of lines.entries()) {
    const line = raw.trimEnd();
    const start = line.trimStart();

    if (fence > 0) {
      if (current !== null) {
        current.lines.push(line);
      }
      if (isFenceClose(line, fence)) {
        fence = 0;
      }
      continue;
    }

    const ticks = fenceTicks(line);
    if (current !== null && ticks >= 3) {
      current.lines.push(line);
      fence = ticks;
      continue;
    }

    // The title may use any `#` count; only its text identifies it.
    if (current === null && /^#{1,6} Code review:/.test(start)) {
      continue;
    }
    if (current === null && start.startsWith('ravi-review ')) {
      parseHeaderLine(start, header);
      continue;
    }
    if (start.startsWith('### ')) {
      current = { reply: true, heading: start.slice(4), line: index + 1, lines: [] };
      sections.push(current);
      continue;
    }
    if (start.startsWith('## ')) {
      current = { reply: false, heading: start.slice(3), line: index + 1, lines: [] };
      sections.push(current);
      continue;
    }
    if (current !== null) {
      current.lines.push(line);
    }
  }
  return { sections, header };
}

function parseHeaderLine(line: string, header: HeaderParts): void {
  for (const segment of line.split(' · ').slice(1)) {
    const part = segment.trim();
    if (part.startsWith('base ')) {
      header.baseSha = toNullable(part.slice(5));
    } else if (part.startsWith('head ')) {
      header.headSha = toNullable(part.slice(5));
    } else if (part.toLowerCase().startsWith('action:')) {
      header.action = parseAction(part.slice(7));
    }
  }
}

function parseAction(value: string): ReviewAction | null {
  const normalized = value.trim().toLowerCase().replaceAll('-', ' ').replaceAll('_', ' ').replace(/\s+/g, ' ');
  if (normalized === 'comment') {
    return 'comment';
  }
  if (normalized === 'approve') {
    return 'approve';
  }
  if (normalized === 'request changes') {
    return 'requestChanges';
  }
  return null;
}

type ParsedHeading = {
  path: string | null;
  side: 'new' | 'old';
  line: number | null;
  startLine: number | null;
  id: string | null;
  author: string | null;
};

/** Location from the right: the path may itself contain spaces and colons. */
const LOCATION = /^(.*?):(\d+)(?:-(\d+))? \((new|old)\)(?: · id (.*?))?(?: · (.*))?$/;
const SUFFIX = /^(?: · id (.*?))?(?: · (.*))?$/;

function parseCommentHeading(heading: string): ParsedHeading | null {
  if (heading === 'PR' || heading.startsWith('PR · ')) {
    const suffix = parseSuffix(heading.slice(2));
    return { path: null, side: 'new', line: null, startLine: null, id: suffix.id, author: suffix.author };
  }

  const match = LOCATION.exec(heading);
  if (match === null) {
    return null;
  }
  const path = match[1] ?? '';
  const first = Number(match[2]);
  const lastText = match[3];
  const last = lastText === undefined ? first : Number(lastText);
  if (path === '' || !Number.isInteger(first) || !Number.isInteger(last) || first < 1 || last < 1) {
    return null;
  }
  // A range is written `<start>-<line>`; a hand-written reversed range is normalised instead of lost.
  let startLine = lastText === undefined ? null : first;
  let line = last;
  if (startLine !== null && startLine > line) {
    [startLine, line] = [line, startLine];
  }
  return {
    path,
    side: match[4] === 'old' ? 'old' : 'new',
    line,
    startLine,
    id: toNullable(match[5]),
    author: toNullable(match[6]),
  };
}

function parseReplyHeading(heading: string): { id: string | null; author: string | null } | null {
  const match = /^reply(?: · id (.*?))?(?: · (.*))?$/.exec(heading);
  if (match === null) {
    return null;
  }
  return { id: toNullable(match[1]), author: toNullable(match[2]) };
}

function parseSuffix(text: string): { id: string | null; author: string | null } {
  const match = SUFFIX.exec(text);
  if (match === null) {
    return { id: null, author: null };
  }
  return { id: toNullable(match[1]), author: toNullable(match[2]) };
}

function toNullable(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** Body of a `## Summary` section; no code block is defined there. */
function parseBody(raw: string[]): string {
  const lines = trimBlankEdges(raw);
  return lines.map(unquote).join('\n');
}

function parseContent(raw: string[]): { body: string; codeContext: string | null } {
  const lines = trimBlankEdges(raw);
  let codeContext: string | null = null;

  const first = lines[0];
  if (first !== undefined && fenceTicks(first) >= 3) {
    const open = fenceTicks(first);
    lines.shift();
    const code: string[] = [];
    let line = lines.shift();
    while (line !== undefined && !isFenceClose(line, open)) {
      code.push(line);
      line = lines.shift();
    }
    codeContext = code.join('\n');
  }

  return { body: trimBlankEdges(lines).map(unquote).join('\n'), codeContext };
}

function trimBlankEdges(raw: string[]): string[] {
  const lines = [...raw];
  while (lines.length > 0 && (lines[0] ?? '').trim() === '') {
    lines.shift();
  }
  while (lines.length > 0 && (lines[lines.length - 1] ?? '').trim() === '') {
    lines.pop();
  }
  return lines;
}

/** One level of quoting is the body; a missing prefix on a blank line is tolerated. */
function unquote(line: string): string {
  if (line === '>') {
    return '';
  }
  if (line.startsWith('> ')) {
    return line.slice(2);
  }
  if (line.startsWith('>')) {
    return line.slice(1);
  }
  return line;
}

function fenceTicks(line: string): number {
  let count = 0;
  while (line[count] === '`') {
    count += 1;
  }
  return count;
}

function isFenceClose(line: string, open: number): boolean {
  const trimmed = line.trim();
  return trimmed.length >= open && /^`+$/.test(trimmed);
}
