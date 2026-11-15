/**
 * Saving the Markdown export as a file. The name is derived from the repository and the target, so
 * two reviews of the same repository do not overwrite each other; anything Windows or macOS treats
 * as a path separator is replaced.
 */
const UNSAFE_FILE_CHARS = /[\\/:*?"<>|]/g;
const CONTROL_CHARS = /[\u0000-\u001f]/g;

export function reviewFileName(repoName: string, encodedTarget: string): string {
  return `ravi-${safePart(repoName)}-${safePart(encodedTarget)}.review.md`;
}

function safePart(value: string): string {
  return value.replace(UNSAFE_FILE_CHARS, '-').replace(CONTROL_CHARS, '-');
}

/** Blob + a temporary anchor; the object URL is revoked so the export does not leak memory. */
export function downloadMarkdown(fileName: string, markdown: string): void {
  const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
