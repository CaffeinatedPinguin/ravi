/**
 * Markdown rendering for comment bodies.
 *
 * Input is untrusted (it can come from a forge or an import), so raw HTML stays off; links are
 * restricted to http(s) and open in a new tab without a handle on `window.opener`. Images that
 * travel with a review use the `asset:` scheme and are served by the local assets route.
 */
import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({ html: false, linkify: false, breaks: true });
const HTTP_URL = /^https?:\/\//i;
const ASSET_URL = /^asset:([A-Za-z0-9._-]+)$/;

type Token = ReturnType<typeof md.parse>[number];

export function renderMarkdown(body: string): string {
  const env = {};
  const tokens = md.parse(body, env);
  for (const token of tokens) {
    if (token.type !== 'inline' || token.children === null) {
      continue;
    }
    token.children = sanitizeInline(token.children);
  }
  return md.renderer.render(tokens, md.options, env);
}

/** Works on the inline token stream: links and images are the only nodes that can leave the page. */
function sanitizeInline(children: Token[]): Token[] {
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
      } else if (HTTP_URL.test(source)) {
        output.push(child);
      }
      continue;
    }
    output.push(child);
  }
  return output;
}
