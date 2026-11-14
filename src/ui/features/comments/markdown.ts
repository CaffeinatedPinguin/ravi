/**
 * Markdown rendering for comment bodies.
 *
 * Input is untrusted (it can come from a forge or an import), so raw HTML stays off; links are
 * restricted to http(s) and open in a new tab without a handle on `window.opener`. Images that
 * travel with a review use the `asset:` scheme and are served by the local assets route. Remote
 * images are never loaded directly: the browser would leak the user's IP to the forge/tracker and
 * private uploads would fail without the token. With a repository context they go through the
 * local proxy; without one we show a link instead of an `<img>`.
 */
import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({ html: false, linkify: false, breaks: true });
const HTTP_URL = /^https?:\/\//i;
const ASSET_URL = /^asset:([A-Za-z0-9._-]+)$/;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

type Token = ReturnType<typeof md.parse>[number];

export type RenderMarkdownOptions = {
  /** Repository id used by `/api/image-proxy`; when absent remote images become links. */
  imageBase?: string;
};

export function renderMarkdown(body: string, options: RenderMarkdownOptions = {}): string {
  const env = {};
  const tokens = md.parse(body, env);
  for (const token of tokens) {
    if (token.type !== 'inline' || token.children === null) {
      continue;
    }
    token.children = sanitizeInline(token.children, options.imageBase);
  }
  return md.renderer.render(tokens, md.options, env);
}

/** Works on the inline token stream: links and images are the only nodes that can leave the page. */
function sanitizeInline(children: Token[], imageBase: string | undefined): Token[] {
  const output: Token[] = [];
  let unsafeLink = false;
  for (const child of children) {
    if (child.type === 'link_open') {
      const href = String(child.attrGet('href') ?? '').trim();
      unsafeLink = !HTTP_URL.test(href);
      if (!unsafeLink) {
        child.attrSet('target', '_blank');
        child.attrSet('rel', 'noopener noreferrer');
        output.push(child);
      }
      continue;
    }
    if (child.type === 'link_close') {
      if (!unsafeLink) {
        output.push(child);
      }
      unsafeLink = false;
      continue;
    }
    if (child.type === 'image') {
      const source = String(child.attrGet('src') ?? '').trim();
      const asset = ASSET_URL.exec(source);
      if (asset?.[1] !== undefined) {
        child.attrSet('src', `/api/assets/${asset[1]}`);
        output.push(child);
      } else if (HTTP_URL.test(source) || isRelative(source)) {
        if (imageBase === undefined || imageBase === '') {
          output.push(externalImageLink(source));
        } else {
          child.attrSet('src', proxyUrl(source, imageBase));
          output.push(child);
        }
      }
      // Any other scheme (javascript:, data:, file:, …) is dropped, as before.
      continue;
    }
    output.push(child);
  }
  return output;
}

function proxyUrl(source: string, imageBase: string): string {
  return `/api/image-proxy?url=${encodeURIComponent(source)}&repo=${encodeURIComponent(imageBase)}`;
}

/** A relative path without a `scheme:`; `//host/...` is protocol-relative and stays out. */
function isRelative(source: string): boolean {
  return !SCHEME.test(source) && !source.startsWith('//');
}

/**
 * `html_inline` is the one token type whose renderer emits its content verbatim, which lets us
 * produce a safe link without constructing a full markdown-it Token; the href is escaped here.
 */
function externalImageLink(source: string): Token {
  const href = escapeAttribute(source);
  const content = `<a href="${href}" target="_blank" rel="noopener noreferrer">external image</a>`;
  return {
    type: 'html_inline',
    tag: '',
    attrs: null,
    map: null,
    nesting: 0,
    level: 0,
    children: null,
    content,
    markup: '',
    info: '',
    meta: null,
    block: false,
    hidden: false,
  } as unknown as Token;
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
