/** The file tree beside the diff: filter box plus a virtualized list, so ten thousand files cost the same as ten. */
import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { DiffFile, FileStatus } from '../../../shared/api.ts';
import { Icon } from '../../components/Icon.tsx';
import styles from './FileTree.module.css';
import { buildTreeItems } from './tree.ts';

const ITEM_HEIGHT = 26;

const STATUS_LETTER: Record<FileStatus, string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  untracked: 'U',
};

type FileTreeProps = {
  files: readonly DiffFile[];
  activeFile: number;
  onSelect: (fileIndex: number) => void;
};

export function FileTree({ files, activeFile, onSelect }: FileTreeProps) {
  const [filter, setFilter] = useState('');
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const items = useMemo(() => buildTreeItems(files, filter, collapsed), [files, filter, collapsed]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ITEM_HEIGHT,
    overscan: 12,
  });

  // Keep the file being read visible in the tree while the diff scrolls.
  const activeItem = useMemo(() => items.findIndex((item) => item.kind === 'file' && item.fileIndex === activeFile), [items, activeFile]);
  useEffect(() => {
    if (activeItem >= 0) {
      virtualizer.scrollToIndex(activeItem, { align: 'auto' });
    }
  }, [activeItem, virtualizer]);

  const toggleDirectory = (path: string) => {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (!next.delete(path)) {
        next.add(path);
      }
      return next;
    });
  };

  return (
    <nav className={styles.tree} aria-label="Changed files">
      <div className={styles.filter}>
        <Icon name="search" />
        <input
          type="search"
          value={filter}
          placeholder="Filter files"
          aria-label="Filter files"
          onChange={(event) => setFilter(event.target.value)}
        />
      </div>
      <div ref={scrollRef} className={styles.scroll}>
        {items.length === 0 && <p className={styles.empty}>No files match.</p>}
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((virtual) => {
            const item = items[virtual.index];
            if (!item) {
              return null;
            }
            const style = { transform: `translateY(${virtual.start}px)`, paddingLeft: 8 + item.depth * 14 };
            if (item.kind === 'dir') {
              return (
                <button
                  key={`d:${item.path}`}
                  type="button"
                  className={styles.item}
                  style={style}
                  aria-expanded={!item.collapsed}
                  onClick={() => toggleDirectory(item.path)}
                >
                  <Icon name={item.collapsed ? 'chevronRight' : 'chevronDown'} size={14} />
                  <span className={styles.name}>{item.name}</span>
                </button>
              );
            }
            const file = files[item.fileIndex];
            if (!file) {
              return null;
            }
            return (
              <button
                key={`f:${item.fileIndex}`}
                type="button"
                className={styles.item}
                style={style}
                aria-current={item.fileIndex === activeFile ? 'true' : undefined}
                title={file.path}
                onClick={() => onSelect(item.fileIndex)}
              >
                <span className={styles.status} data-status={file.status} aria-label={file.status}>
                  {STATUS_LETTER[file.status]}
                </span>
                <span className={styles.name}>{item.name}</span>
                <span className={styles.counts}>
                  {file.additions > 0 && <span className={styles.add}>+{file.additions}</span>}
                  {file.deletions > 0 && <span className={styles.del}>−{file.deletions}</span>}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
