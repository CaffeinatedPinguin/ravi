/**
 * The scrolling diff: one virtualized list over every row of every file.
 * Only rows near the viewport exist in the DOM, and patches are requested as files come into view.
 */
import { useVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import type { KeyboardEvent, Ref } from 'react';
import type { CommentSide } from '../../../shared/review.ts';
import type { ReviewStore } from '../comments/reviewStore.ts';
import { DiffRow, FileHeader } from './DiffRow.tsx';
import styles from './DiffView.module.css';
import { isMeasuredRow, rowHeight } from './rows.ts';
import type { ViewMode } from './rows.ts';
import type { DiffSession } from './session.ts';

/** Files past the viewport whose patches are fetched ahead of time. */
const PRELOAD_FILES = 8;
/** Width of the line-number gutter in pixels; must match `.number` in the stylesheet. */
const GUTTER = 52;

export type DiffViewHandle = { scrollToFile: (fileIndex: number) => void };

type FocusedLine = { fileIndex: number; side: CommentSide; line: number };
type FocusLineSetter = (fileIndex: number, side: CommentSide, line: number) => void;

type DiffViewProps = {
  session: DiffSession;
  mode: ViewMode;
  expandStep: number;
  repoPath: string | null;
  store: ReviewStore | null;
  onActiveFileChange: (fileIndex: number) => void;
  ref: Ref<DiffViewHandle>;
};

export function DiffView({ session, mode, expandStep, repoPath, store, onActiveFileChange, ref }: DiffViewProps) {
  const version = useSyncExternalStore(session.subscribe, session.getVersion);
  const scrollRef = useRef<HTMLDivElement>(null);
  const focusedLine = useRef<FocusedLine | null>(null);
  const virtualizer = useVirtualizer({
    count: session.rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => {
      const rowRef = session.rowAt(index);
      return rowRef ? rowHeight(rowRef.row) : 0;
    },
    overscan: 20,
  });

  /** Pixel offset of a file from the virtualizer, so measured thread rows are accounted for. */
  const fileOffset = useCallback(
    (fileIndex: number): number => {
      const offset = virtualizer.getOffsetForIndex(session.fileStartRow(fileIndex));
      return offset?.[0] ?? 0;
    },
    [session, virtualizer],
  );

  const fileIndexAtOffset = useCallback(
    (offset: number): number => {
      const items = virtualizer.getVirtualItems();
      const item = items.find((candidate) => candidate.start + candidate.size > offset) ?? items.at(-1);
      return item === undefined ? 0 : session.fileIndexAtRow(item.index);
    },
    [session, virtualizer],
  );

  // When rows above the viewport change height (a patch arrives, a gap expands, a comment is
  // added), keep the file being read in place instead of letting the content jump.
  // The anchor is "this file, this many pixels in"; the row start is read from the virtualizer so
  // measured rows shift the anchor exactly as they shift the content.
  const anchor = useRef({ fileIndex: 0, offset: 0 });
  const appliedVersion = useRef(version);
  const recordAnchor = () => {
    const element = scrollRef.current;
    // While a new layout is waiting to be applied, the old anchor is still the truth.
    if (element && appliedVersion.current === session.getVersion()) {
      const fileIndex = fileIndexAtOffset(element.scrollTop);
      anchor.current = { fileIndex, offset: element.scrollTop - fileOffset(fileIndex) };
    }
  };
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element || appliedVersion.current === version) {
      return;
    }
    appliedVersion.current = version;
    virtualizer.measure();
    const target = fileOffset(anchor.current.fileIndex) + anchor.current.offset;
    if (Math.abs(target - element.scrollTop) > 1) {
      element.scrollTop = target;
    }
  }, [session, version, virtualizer, fileOffset]);

  const items = virtualizer.getVirtualItems();
  const firstRow = items[0]?.index;
  const lastRow = items.at(-1)?.index;
  const scrollTop = virtualizer.scrollOffset ?? 0;
  const activeFile = fileIndexAtOffset(scrollTop);

  useEffect(() => {
    if (firstRow === undefined || lastRow === undefined) {
      return;
    }
    const from = session.fileIndexAtRow(firstRow);
    const to = session.fileIndexAtRow(lastRow) + PRELOAD_FILES;
    session.requestFiles(Array.from({ length: to - from + 1 }, (_, offset) => from + offset));
  }, [session, firstRow, lastRow, version]);

  useEffect(() => onActiveFileChange(activeFile), [activeFile, onActiveFileChange]);

  useImperativeHandle(
    ref,
    () => ({
      scrollToFile: (fileIndex) => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = fileOffset(fileIndex);
        }
      },
    }),
    [fileOffset],
  );

  const focusLine = useCallback<FocusLineSetter>((fileIndex, side, line) => {
    focusedLine.current = { fileIndex, side, line };
  }, []);

  // `c` on the hovered/focused line opens the same composer the gutter button does.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'c' || event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    const target = event.target;
    if (target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable]')) {
      return;
    }
    const line = focusedLine.current;
    if (!line) {
      return;
    }
    event.preventDefault();
    session.openComposer(line.fileIndex, line.side, line.line, false);
  };

  // The scroll area must be as wide as the longest line; rows are absolutely positioned and cannot size it.
  const columns = session.longestLineLength + 4;
  const contentWidth = mode === 'split' ? `calc(${2 * GUTTER}px + ${2 * columns}ch)` : `calc(${2 * GUTTER}px + ${columns}ch)`;

  const activeView = session.view(activeFile);
  const showPinnedHeader = activeView !== undefined && scrollTop > fileOffset(activeFile);

  return (
    <div className={styles.view}>
      {showPinnedHeader && (
        <div className={styles.pinnedHeader} style={{ width: scrollRef.current?.clientWidth }}>
          <FileHeader view={activeView} fileIndex={activeFile} session={session} repoPath={repoPath} />
        </div>
      )}
      <div
        ref={scrollRef}
        className={styles.scroll}
        tabIndex={0}
        aria-label="Diff"
        onScroll={recordAnchor}
        onKeyDown={onKeyDown}
      >
        <div className={styles.content} style={{ height: virtualizer.getTotalSize(), minWidth: contentWidth }}>
          {items.map((item) => {
            const rowRef = session.rowAt(item.index);
            const view = rowRef && session.view(rowRef.fileIndex);
            if (!rowRef || !view) {
              return null;
            }
            const measured = isMeasuredRow(rowRef.row);
            return (
              <div
                key={item.key}
                className={styles.row}
                data-index={item.index}
                ref={measured ? virtualizer.measureElement : undefined}
                style={{ height: measured ? undefined : item.size, transform: `translateY(${item.start}px)` }}
              >
                <DiffRow
                  row={rowRef.row}
                  fileIndex={rowRef.fileIndex}
                  view={view}
                  tokens={session.tokensOf(rowRef.fileIndex)}
                  session={session}
                  store={store}
                  expandStep={expandStep}
                  repoPath={repoPath}
                  onFocusLine={focusLine}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
