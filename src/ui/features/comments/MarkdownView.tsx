import { renderMarkdown } from './markdown.ts';
import styles from './Comments.module.css';

/**
 * Renders a comment body produced by `renderMarkdown`; the HTML is already escaped by markdown-it.
 * `imageBase` is the repository id a caller knows (e.g. a pull request page); without it remote
 * images are shown as links rather than requested directly.
 */
export function MarkdownView({ body, imageBase }: { body: string; imageBase?: string }) {
  return (
    <div
      className={styles.markdown}
      dangerouslySetInnerHTML={{ __html: renderMarkdown(body, imageBase === undefined ? {} : { imageBase }) }}
    />
  );
}
