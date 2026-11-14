/** Builds the file tree shown next to the diff: a flat, depth-annotated list ready for a virtualized scroller. */
import type { DiffFile } from '../../../shared/api.ts';

export type TreeItem =
  | { kind: 'dir'; path: string; name: string; depth: number; collapsed: boolean }
  | { kind: 'file'; fileIndex: number; name: string; depth: number };

type Directory = { name: string; path: string; directories: Map<string, Directory>; files: Array<{ name: string; fileIndex: number }> };

const newDirectory = (name: string, path: string): Directory => ({ name, path, directories: new Map(), files: [] });

/**
 * @param filter       case-insensitive substring of the path; an empty string keeps every file
 * @param collapsed    paths of directories the user folded
 */
export function buildTreeItems(files: readonly DiffFile[], filter: string, collapsed: ReadonlySet<string>): TreeItem[] {
  const root = newDirectory('', '');
  const needle = filter.trim().toLowerCase();
  for (const [fileIndex, file] of files.entries()) {
    if (needle !== '' && !file.path.toLowerCase().includes(needle)) {
      continue;
    }
    const segments = file.path.split('/');
    const name = segments.pop() ?? file.path;
    let directory = root;
    for (const segment of segments) {
      let child = directory.directories.get(segment);
      if (!child) {
        child = newDirectory(segment, directory.path === '' ? segment : `${directory.path}/${segment}`);
        directory.directories.set(segment, child);
      }
      directory = child;
    }
    directory.files.push({ name, fileIndex });
  }
  const items: TreeItem[] = [];
  appendDirectory(items, root, 0, collapsed);
  return items;
}

function appendDirectory(items: TreeItem[], directory: Directory, depth: number, collapsed: ReadonlySet<string>): void {
  // Same ordering as the server's compareTreeOrder, so tree and diff stay in step.
  const directories = [...directory.directories.values()].sort((left, right) => (left.name < right.name ? -1 : 1));
  for (const child of directories) {
    // A chain of folders that hold nothing but one sub-folder is shown as a single "a/b/c" row.
    let merged = child;
    let name = child.name;
    while (merged.files.length === 0 && merged.directories.size === 1) {
      merged = merged.directories.values().next().value as Directory;
      name = `${name}/${merged.name}`;
    }
    const isCollapsed = collapsed.has(merged.path);
    items.push({ kind: 'dir', path: merged.path, name, depth, collapsed: isCollapsed });
    if (!isCollapsed) {
      appendDirectory(items, merged, depth + 1, collapsed);
    }
  }
  for (const file of directory.files) {
    items.push({ kind: 'file', fileIndex: file.fileIndex, name: file.name, depth });
  }
}
