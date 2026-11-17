/**
 * Main-thread side of syntax highlighting. Tokenising runs in a Web Worker so that scrolling a
 * large diff never waits for it; this module only maps file names to languages and passes messages.
 */
import type { HighlightRequest, HighlightResponse } from './highlight.worker.ts';

/** One line as coloured fragments: `[text, cssColor]`; the colour is a CSS variable or `null` for default text. */
export type LineTokens = ReadonlyArray<readonly [text: string, color: string | null]>;

/** File extension (or whole file name) → shiki language id. Unknown files are shown as plain text. */
const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'tsx',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx',
  json: 'json', jsonc: 'jsonc', json5: 'json5',
  yml: 'yaml', yaml: 'yaml', toml: 'toml', ini: 'ini', properties: 'properties',
  md: 'markdown', html: 'html', htm: 'html', xml: 'xml', svg: 'xml', vue: 'vue', svelte: 'svelte', astro: 'astro',
  css: 'css', scss: 'scss', less: 'less',
  java: 'java', kt: 'kotlin', kts: 'kotlin', groovy: 'groovy', gradle: 'groovy', scala: 'scala',
  py: 'python', go: 'go', rs: 'rust', rb: 'ruby', php: 'php', swift: 'swift', dart: 'dart', lua: 'lua',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp', cs: 'csharp',
  sh: 'shellscript', bash: 'shellscript', zsh: 'shellscript', ps1: 'powershell', bat: 'bat', cmd: 'bat',
  sql: 'sql', graphql: 'graphql', gql: 'graphql', proto: 'proto',
  tf: 'terraform', hcl: 'hcl', conf: 'nginx', diff: 'diff', patch: 'diff',
  dockerfile: 'dockerfile', makefile: 'make', mk: 'make',
};

export function languageForPath(path: string): string | null {
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : name;
  // Own keys only: the name comes from the reviewed repository, and a file called x.constructor
  // must not resolve to a member inherited from Object.prototype.
  return Object.hasOwn(LANGUAGE_BY_EXTENSION, extension) ? (LANGUAGE_BY_EXTENSION[extension] ?? null) : null;
}

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, { resolve: (lines: LineTokens[]) => void; reject: (error: Error) => void }>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./highlight.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<HighlightResponse>) => {
      const request = pending.get(event.data.id);
      pending.delete(event.data.id);
      if (event.data.lines) {
        request?.resolve(event.data.lines);
      } else {
        request?.reject(new Error(event.data.error ?? 'Highlighting failed'));
      }
    };
  }
  return worker;
}

export function highlightLines(language: string, lines: readonly string[]): Promise<LineTokens[]> {
  if (lines.length === 0) {
    return Promise.resolve([]);
  }
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    const request: HighlightRequest = { id, language, lines: [...lines] };
    getWorker().postMessage(request);
  });
}
