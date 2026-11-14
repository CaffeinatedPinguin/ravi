import { renderMarkdown } from './markdown.ts';
import styles from './Comments.module.css';

/** Renders a comment body produced by `renderMarkdown`; the HTML is already escaped by markdown-it. */
export function MarkdownView({ body }: { body: string }) {
  return <div className={styles.markdown} dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }} />;
}
