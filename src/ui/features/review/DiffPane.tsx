/**
 * File tree + resizer + diff, shared by the local review and the pull request review.
 * Both screens own the data; this component only arranges the three pieces.
 */
import type { ReactNode, Ref } from 'react';
import type { ReviewStore } from '../comments/reviewStore.ts';
import { DiffView } from '../diff/DiffView.tsx';
import type { DiffViewHandle } from '../diff/DiffView.tsx';
import { FileTree } from '../diff/FileTree.tsx';
import type { DiffSession } from '../diff/session.ts';
import type { ViewMode } from '../diff/rows.ts';
import styles from './ReviewPage.module.css';
import { TreeResizer } from './TreeResizer.tsx';

type DiffPaneProps = {
  session: DiffSession;
  store: ReviewStore;
  /** Absolute path for a local folder; null for a remote clone. */
  repoPath: string | null;
  treeWidth: number;
  activeFile: number;
  mode: ViewMode;
  expandStep: number;
  commentCount: (path: string) => number;
  onSelectFile: (fileIndex: number) => void;
  onActiveFileChange: (fileIndex: number) => void;
  onResize: (width: number | null) => void;
  onCommitWidth: (width: number) => void;
  viewRef: Ref<DiffViewHandle>;
};

export function DiffPane({
  session,
  store,
  repoPath,
  treeWidth,
  activeFile,
  mode,
  expandStep,
  commentCount,
  onSelectFile,
  onActiveFileChange,
  onResize,
  onCommitWidth,
  viewRef,
}: DiffPaneProps) {
  return (
    <>
      <FileTree files={session.files} activeFile={activeFile} onSelect={onSelectFile} commentCount={commentCount} />
      <TreeResizer width={treeWidth} onChange={onResize} onCommit={onCommitWidth} />
      <DiffView
        key={session.id}
        ref={viewRef}
        session={session}
        mode={mode}
        expandStep={expandStep}
        repoPath={repoPath}
        store={store}
        onActiveFileChange={onActiveFileChange}
      />
    </>
  );
}

/** The empty/loading column message; shared so both review screens look the same. */
export function DiffMessage({ children }: { children: ReactNode }) {
  return <div className={styles.message}>{children}</div>;
}
