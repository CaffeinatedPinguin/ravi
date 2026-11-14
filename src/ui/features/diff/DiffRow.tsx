/** Renders one row of the diff. Memoised: while scrolling, only rows that enter the viewport render. */
import { memo } from 'react';
import type { DiffFile } from '../../../shared/api.ts';
import { Button, IconButton } from '../../components/controls.tsx';
import { Icon } from '../../components/Icon.tsx';
import styles from './DiffView.module.css';
import type { LineTokens } from './highlight.ts';
import type { DiffLine } from './patch.ts';
import type { FileView, Row } from './rows.ts';
import type { DiffSession, FileTokens } from './session.ts';

type DiffRowProps = {
  row: Row;
  fileIndex: number;
  view: FileView;
  tokens: FileTokens | undefined;
  session: DiffSession;
  expandStep: number;
  /** Absolute path of the repository, for the file path link. */
  repoPath: string;
};

export const DiffRow = memo(function DiffRow({ row, fileIndex, view, tokens, session, expandStep, repoPath }: DiffRowProps) {
  switch (row.kind) {
    case 'file':
      return <FileHeader view={view} fileIndex={fileIndex} session={session} repoPath={repoPath} />;
    case 'line':
      return (
        <div className={styles.line} data-type={row.line.type}>
          <span className={styles.number}>{row.line.oldNo}</span>
          <span className={styles.number}>{row.line.newNo}</span>
          <Code line={row.line} tokens={lineTokens(tokens, row.line)} />
        </div>
      );
    case 'split':
      return (
        <div className={styles.split}>
          <SplitSide line={row.left} side="old" tokens={tokens} />
          <SplitSide line={row.right} side="new" tokens={tokens} />
        </div>
      );
    case 'gap':
      return (
        <div className={`${styles.pinnedWidth} ${styles.gap}`}>
          {row.canExpandDown && (
            <IconButton
              icon="arrowDown"
              label={`Show ${expandStep} more lines below`}
              onClick={() => void session.expandGap(fileIndex, row.gapIndex, 'down', expandStep)}
            />
          )}
          {row.canExpandUp && (
            <IconButton
              icon="arrowUp"
              label={`Show ${expandStep} more lines above`}
              onClick={() => void session.expandGap(fileIndex, row.gapIndex, 'up', expandStep)}
            />
          )}
          <IconButton icon="expand" label="Show all hidden lines" onClick={() => void session.expandGap(fileIndex, row.gapIndex, 'all', expandStep)} />
          <span className={styles.gapText}>
            {row.hidden !== null && `${row.hidden} hidden ${row.hidden === 1 ? 'line' : 'lines'}`}
            {row.section !== '' && <span className={styles.section}>{row.section}</span>}
          </span>
        </div>
      );
    case 'notice':
      return <Notice row={row} view={view} fileIndex={fileIndex} session={session} />;
  }
});

function lineTokens(tokens: FileTokens | undefined, line: DiffLine): LineTokens | undefined {
  if (!tokens) {
    return undefined;
  }
  return line.newNo !== null ? tokens.new.get(line.newNo) : line.oldNo !== null ? tokens.old.get(line.oldNo) : undefined;
}

function SplitSide({ line, side, tokens }: { line: DiffLine | null; side: 'old' | 'new'; tokens: FileTokens | undefined }) {
  if (!line) {
    return <div className={styles.half} data-type="empty" />;
  }
  const number = side === 'old' ? line.oldNo : line.newNo;
  const sideTokens = number === null ? undefined : (side === 'old' ? tokens?.old : tokens?.new)?.get(number);
  return (
    <div className={styles.half} data-type={line.type}>
      <span className={styles.number}>{number}</span>
      <Code line={line} tokens={sideTokens} />
    </div>
  );
}

const SIGN = { add: '+', del: '−', context: ' ' } as const;

function Code({ line, tokens }: { line: DiffLine; tokens: LineTokens | undefined }) {
  return (
    <span className={styles.code}>
      {/* Not selectable, so copying code from the diff yields clean text. */}
      <span className={styles.sign} aria-hidden="true">
        {SIGN[line.type]}
      </span>
      {tokens
        ? tokens.map(([text, color], index) => (
            <span key={index} style={color === null ? undefined : { color }}>
              {text}
            </span>
          ))
        : line.text}
    </span>
  );
}

const STATUS_LABEL: Record<DiffFile['status'], string | null> = {
  added: 'Added',
  modified: null,
  deleted: 'Deleted',
  renamed: 'Renamed',
  copied: 'Copied',
  untracked: 'Untracked',
};

type FileHeaderProps = { view: FileView; fileIndex: number; session: DiffSession; repoPath: string };

export function FileHeader({ view, fileIndex, session, repoPath }: FileHeaderProps) {
  const { file } = view;
  const absolutePath = `${repoPath}/${file.path}`;
  const status = STATUS_LABEL[file.status];
  const canExpand = view.load.status === 'loaded' && !view.collapsed && (file.status === 'modified' || file.status === 'renamed');
  return (
    <div className={`${styles.pinnedWidth} ${styles.fileHeader}`}>
      <IconButton
        icon={view.collapsed ? 'chevronRight' : 'chevronDown'}
        label={view.collapsed ? 'Expand file' : 'Collapse file'}
        aria-expanded={!view.collapsed}
        onClick={() => session.toggleCollapsed(fileIndex)}
      />
      <button
        type="button"
        className={styles.path}
        title={`Copy path: ${absolutePath}`}
        onClick={() => void navigator.clipboard.writeText(absolutePath)}
      >
        {file.oldPath !== null && <span className={styles.oldPath}>{file.oldPath} → </span>}
        {file.path}
      </button>
      {status !== null && (
        <span className={styles.badge} data-status={file.status}>
          {status}
        </span>
      )}
      <span className={styles.counts}>
        <span className={styles.add}>+{file.additions}</span>
        <span className={styles.del}>−{file.deletions}</span>
      </span>
      <span className={styles.spacer} />
      {canExpand && <IconButton icon="expand" label="Show full file" onClick={() => void session.expandWholeFile(fileIndex)} />}
      {file.status !== 'deleted' && (
        <a className={styles.headerLink} href={`vscode://file/${encodeURI(absolutePath)}`} title="Open in editor" aria-label="Open in editor">
          <Icon name="external" />
        </a>
      )}
    </div>
  );
}

type NoticeProps = { row: Extract<Row, { kind: 'notice' }>; view: FileView; fileIndex: number; session: DiffSession };

function Notice({ row, view, fileIndex, session }: NoticeProps) {
  const changes = view.file.additions + view.file.deletions;
  return (
    <div className={`${styles.pinnedWidth} ${styles.notice}`} data-notice={row.notice} aria-busy={row.notice === 'loading'}>
      {row.notice === 'loading' && <span className={styles.skeleton} />}
      {row.notice === 'binary' && 'Binary file not shown.'}
      {row.notice === 'empty' && 'No content changes (file mode or whitespace only).'}
      {row.notice === 'large' && (
        <>
          Large diff not rendered ({changes.toLocaleString()} changed lines).
          <Button onClick={() => session.loadLargeFile(fileIndex)}>Load diff</Button>
        </>
      )}
      {row.notice === 'error' && (
        <>
          <span role="alert">{view.load.status === 'error' ? view.load.message : 'Could not load the diff.'}</span>
          <Button onClick={() => session.retry(fileIndex)}>Retry</Button>
        </>
      )}
    </div>
  );
}
