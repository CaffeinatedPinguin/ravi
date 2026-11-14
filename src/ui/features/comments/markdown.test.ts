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

  it('proxies https images through the local image proxy when a repository context is known', () => {
    const html = renderMarkdown('![shot](https://example.test/private/shot.png)', { imageBase: 'a1b2c3d4' });
    expect(html.replaceAll('&amp;', '&')).toContain(
      'src="/api/image-proxy?url=https%3A%2F%2Fexample.test%2Fprivate%2Fshot.png&repo=a1b2c3d4"',
    );
  });

  it('proxies relative forge images through the local image proxy', () => {
    const html = renderMarkdown('![shot](/uploads/abc/shot.png)', { imageBase: 'a1b2c3d4' });
    expect(html.replaceAll('&amp;', '&')).toContain(
      'src="/api/image-proxy?url=%2Fuploads%2Fabc%2Fshot.png&repo=a1b2c3d4"',
    );
  });

  it('drops javascript: and data: image sources', () => {
    const javascript = renderMarkdown('![x](javascript:alert(1))', { imageBase: 'a1b2c3d4' });
    const data = renderMarkdown('![x](data:image/png;base64,AAAA)', { imageBase: 'a1b2c3d4' });
    expect(javascript).not.toContain('<img');
    expect(javascript).not.toContain('src="javascript:');
    expect(data).not.toContain('<img');
    expect(data).not.toContain('src="data:');
  });

  it('shows a link instead of loading an external image without a repository context', () => {
    const html = renderMarkdown('![shot](https://example.test/tracker.png)');
    expect(html).not.toContain('<img');
    expect(html).toContain('href="https://example.test/tracker.png"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('external image');
  });
});
