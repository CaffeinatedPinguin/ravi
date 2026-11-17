/**
 * Web Worker that tokenises code with shiki.
 *
 * Grammars are loaded on first use, one chunk per language. Colours are emitted as CSS variables
 * (`var(--shiki-token-keyword)` …) instead of fixed colours, so one tokenisation serves both the
 * light and the dark theme; the variables are defined in `theme.css`.
 */
import { createCssVariablesTheme, createHighlighterCore } from 'shiki/core';
import type { HighlighterCore, LanguageRegistration } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import type { LineTokens } from './highlight.ts';

export type HighlightRequest = { id: number; language: string; lines: string[] };
export type HighlightResponse = { id: number; lines?: LineTokens[]; error?: string };

type LanguageModule = { default: LanguageRegistration[] };

/** Explicit imports so the bundler emits exactly these grammars and nothing else. */
const LANGUAGES: Record<string, () => Promise<LanguageModule>> = {
  astro: () => import('shiki/langs/astro.mjs'),
  bat: () => import('shiki/langs/bat.mjs'),
  c: () => import('shiki/langs/c.mjs'),
  cpp: () => import('shiki/langs/cpp.mjs'),
  csharp: () => import('shiki/langs/csharp.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  dart: () => import('shiki/langs/dart.mjs'),
  diff: () => import('shiki/langs/diff.mjs'),
  dockerfile: () => import('shiki/langs/dockerfile.mjs'),
  go: () => import('shiki/langs/go.mjs'),
  graphql: () => import('shiki/langs/graphql.mjs'),
  groovy: () => import('shiki/langs/groovy.mjs'),
  hcl: () => import('shiki/langs/hcl.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  ini: () => import('shiki/langs/ini.mjs'),
  java: () => import('shiki/langs/java.mjs'),
  javascript: () => import('shiki/langs/javascript.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  json5: () => import('shiki/langs/json5.mjs'),
  jsonc: () => import('shiki/langs/jsonc.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  kotlin: () => import('shiki/langs/kotlin.mjs'),
  less: () => import('shiki/langs/less.mjs'),
  lua: () => import('shiki/langs/lua.mjs'),
  make: () => import('shiki/langs/make.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  nginx: () => import('shiki/langs/nginx.mjs'),
  php: () => import('shiki/langs/php.mjs'),
  powershell: () => import('shiki/langs/powershell.mjs'),
  properties: () => import('shiki/langs/properties.mjs'),
  proto: () => import('shiki/langs/proto.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  ruby: () => import('shiki/langs/ruby.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  scala: () => import('shiki/langs/scala.mjs'),
  scss: () => import('shiki/langs/scss.mjs'),
  shellscript: () => import('shiki/langs/shellscript.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  svelte: () => import('shiki/langs/svelte.mjs'),
  swift: () => import('shiki/langs/swift.mjs'),
  terraform: () => import('shiki/langs/terraform.mjs'),
  toml: () => import('shiki/langs/toml.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  typescript: () => import('shiki/langs/typescript.mjs'),
  vue: () => import('shiki/langs/vue.mjs'),
  xml: () => import('shiki/langs/xml.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
};

const THEME = 'css-variables';
/** Longer lines (minified code) are cut before tokenising; they would stall the worker for no benefit. */
const MAX_LINE_LENGTH = 2000;

let highlighter: Promise<HighlighterCore> | null = null;
const loading = new Map<string, Promise<void>>();

function getHighlighter(): Promise<HighlighterCore> {
  highlighter ??= createHighlighterCore({
    themes: [createCssVariablesTheme({ name: THEME, variablePrefix: '--shiki-', fontStyle: false })],
    langs: [],
    // Pure JavaScript regex engine: no WebAssembly file to ship or load.
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  });
  return highlighter;
}

async function ensureLanguage(core: HighlighterCore, language: string): Promise<boolean> {
  // Own keys only, so a language name such as "constructor" is never looked up on Object.prototype.
  const load = Object.hasOwn(LANGUAGES, language) ? LANGUAGES[language] : undefined;
  if (!load) {
    return false;
  }
  let ready = loading.get(language);
  if (!ready) {
    ready = load().then((module) => core.loadLanguage(...module.default));
    loading.set(language, ready);
  }
  await ready;
  return true;
}

async function tokenize(request: HighlightRequest): Promise<LineTokens[]> {
  const core = await getHighlighter();
  if (!(await ensureLanguage(core, request.language))) {
    return request.lines.map((line) => [[line, null]]);
  }
  const code = request.lines.map((line) => (line.length > MAX_LINE_LENGTH ? line.slice(0, MAX_LINE_LENGTH) : line)).join('\n');
  const tokens = core.codeToTokensBase(code, { lang: request.language, theme: THEME });
  return request.lines.map((line, index) => {
    const lineTokens: Array<readonly [string, string | null]> = (tokens[index] ?? []).map((token) => [token.content, token.color ?? null]);
    if (line.length > MAX_LINE_LENGTH) {
      lineTokens.push([line.slice(MAX_LINE_LENGTH), null]);
    }
    return lineTokens;
  });
}

self.onmessage = (event: MessageEvent<HighlightRequest>) => {
  const { id } = event.data;
  tokenize(event.data)
    .then((lines) => post({ id, lines }))
    .catch((error: unknown) => post({ id, error: error instanceof Error ? error.message : 'Highlighting failed' }));
};

function post(response: HighlightResponse): void {
  self.postMessage(response);
}
