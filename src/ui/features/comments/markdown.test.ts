import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown.ts';

describe('renderMarkdown', () => {
  it('shows raw HTML from a comment as text', () => {
    const html = renderMarkdown('<script>alert(1)</script> and <img src=x onerror=alert(2)>');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&lt;img src=x onerror=alert(2)&gt;');
  });

  it('does not turn a javascript: link into an anchor', () => {
    const html = renderMarkdown('[click](javascript:alert(1))');
    expect(html).not.toContain('<a ');
    expect(html).toContain('click');
  });

  it('opens http links in a new tab without an opener', () => {
    const html = renderMarkdown('[docs](https://example.test/docs)');
    expect(html).toContain('href="https://example.test/docs"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('renders asset images through the local assets route', () => {
    const html = renderMarkdown('![diagram](asset:ab12cd.png)');
    expect(html).toContain('src="/api/assets/ab12cd.png"');
    expect(html).toContain('alt="diagram"');
  });
});
