/**
 * Reading a review Markdown file chosen, pasted or dropped by the user.
 *
 * Import is a local feature, but a File is still untrusted input: check the extension, the declared
 * text type and the size before reading it, so a huge or binary file never reaches the import route.
 */
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

const IMPORT_EXTENSIONS = ['.md', '.txt'];

/** True when a dropped file is meant for import; image drops belong to the comment composer. */
export function isImportableFile(file: File): boolean {
  return IMPORT_EXTENSIONS.some((extension) => file.name.toLowerCase().endsWith(extension));
}

/** The reason `file` cannot be imported, or null when it can. Pure so the limits are testable. */
export function importFileError(file: File): string | null {
  if (!isImportableFile(file)) {
    return 'Choose a .md or .txt file.';
  }
  // Browsers leave the type empty for unknown extensions; a declared non-text type is suspicious.
  if (file.type !== '' && !file.type.startsWith('text/')) {
    return 'Only text files can be imported.';
  }
  if (file.size > MAX_IMPORT_BYTES) {
    return 'The file is larger than 2 MiB.';
  }
  return null;
}

export async function readImportFile(file: File): Promise<string> {
  const error = importFileError(file);
  if (error !== null) {
    throw new Error(error);
  }
  return file.text();
}
