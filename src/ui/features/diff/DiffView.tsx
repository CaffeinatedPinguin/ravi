/**
 * The scrolling diff: one virtualized list over every row of every file.
 * Only rows near the viewport exist in the DOM, and patches are requested as files come into view.
 */
import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import type { Ref } from 'react';
import { DiffRow, FileHeader } from './DiffRow.tsx';
import styles from './DiffView.module.css';
import { rowHeight } from './rows.ts';
import type { ViewMode } from './rows.ts';
import type { DiffSession } from './session.ts';

/** Files past the viewport whose patches are fetched ahead of time. */
const PRELOAD_FILES = 8;
/** Width of the line-number gutter in pixels; must match `.number` in the stylesheet. */
const GUTTER = 52;

export type DiffViewHandle = { scrollToFile: (fileIndex: number) => void };

type DiffViewProps = {
  session: DiffSession;
  mode: ViewMode;
  expandStep: number;
  repoPath: string;
  onActiveFileChange: (fileIndex: number) => void;
  ref: Ref<DiffViewHandle>;
};

export function DiffView({ session, mode, expandStep, repoPath, onActiveFileChange, ref }: DiffViewProps) {
  const version = useSyncExternalStore(session.subscribe, session.getVersion);
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: session.rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => {
      const ref = session.rowAt(index);
      return ref ? rowHeight(ref.row) : 0;
    },
    overscan: 20,
  });

  // When rows above the viewport change height (a patch arrives, a gap expands), keep the file
  // being read in place instead of letting the content jump.
  // The anchor is "this file, this many pixels in". It is recorded on every scroll event rather
  // than on render, because a layout change can arrive before React has rendered the last scroll.
  const anchor = useRef({ fileIndex: 0, offset: 0 });
  const appliedVersion = useRef(version);
  const recordAnchor = () => {
    const element = scrollRef.current;
    // While a new layout is waiting to be applied, the old anchor is still the truth.
    if (element && appliedVersion.current === session.getVersion()) {
      const fileIndex = session.fileIndexAtPixel(element.scrollTop);
      anchor.current = { fileIndex, offset: element.scrollTop - session.filePixelStart(fileIndex) };
    }
  };
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element || appliedVersion.current === version) {
      return;
    }
    appliedVersion.current = version;
    virtualizer.measure();
    const target = session.filePixelStart(anchor.current.fileIndex) + anchor.current.offset;
    if (Math.abs(target - element.scrollTop) > 1) {
      element.scrollTop = target;
    }
  }, [session, version, virtualizer]);

  const items = virtualizer.getVirtualItems();
  const firstRow = items[0]?.index;
  const lastRow = items.at(-1)?.index;
  const scrollTop = virtualizer.scrollOffset ?? 0;
  const activeFile = session.fileIndexAtPixel(scrollTop);

  useEffect(() => {
    if (firstRow === undefined || lastRow === undefined) {
      return;
    }
    const from = session.fileIndexAtRow(firstRow);
    const to = session.fileIndexAtRow(lastRow) + PRELOAD_FILES;
    session.requestFiles(Array.from({ length: to - from + 1 }, (_, offset) => from + offset));
  }, [session, firstRow, lastRow, version]);

  useEffect(() => onActiveFileChange(activeFile), [activeFile, onActiveFileChange]);

  useImperativeHandle(ref, () => ({
    scrollToFile: (fileIndex) => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = session.filePixelStart(fileIndex);
      }
    },
  }));

  // The scroll area must be as wide as the longest line; rows are absolutely positioned and cannot size it.
  const columns = session.longestLineLength + 4;
  const contentWidth = mode === 'split' ? `calc(${2 * GUTTER}px + ${2 * columns}ch)` : `calc(${2 * GUTTER}px + ${columns}ch)`;

  const activeView = session.view(activeFile);
  const showPinnedHeader = activeView !== undefined && scrollTop > session.filePixelStart(activeFile);

  return (
    <div className={styles.view}>
      {showPinnedHeader && (
        <div className={styles.pinnedHeader} style={{ width: scrollRef.current?.clientWidth }}>
          <FileHeader view={activeView} fileIndex={activeFile} session={session} repoPath={repoPath} />
        </div>
      )}
      <div ref={scrollRef} className={styles.scroll} tabIndex={0} aria-label="Diff" onScroll={recordAnchor}>
        <div className={styles.content} style={{ height: virtualizer.getTotalSize(), minWidth: contentWidth }}>
          {items.map((item) => {
            const rowRef = session.rowAt(item.index);
            const view = rowRef && session.view(rowRef.fileIndex);
            if (!rowRef || !view) {
              return null;
            }
            return (
              <div key={item.key} className={styles.row} style={{ height: item.size, transform: `translateY(${item.start}px)` }}>
                <DiffRow
                  row={rowRef.row}
                  fileIndex={rowRef.fileIndex}
                  view={view}
                  tokens={session.tokensOf(rowRef.fileIndex)}
                  session={session}
                  expandStep={expandStep}
                  repoPath={repoPath}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
