/** Renders one row of the diff. Memoised: while scrolling, only rows that enter the viewport render. */
import { memo } from 'react';
import type { DiffFile } from '../../../shared/api.ts';
import type { CommentSide } from '../../../shared/review.ts';
import { ComposerRow } from '../comments/ComposerRow.tsx';
import type { ReviewStore } from '../comments/reviewStore.ts';
import { ThreadRow } from '../comments/Thread.tsx';
import { LineLink } from '../pulls/LinkMode.tsx';
import { Button, IconButton } from '../../components/controls.tsx';
import { Icon } from '../../components/Icon.tsx';
import styles from './DiffView.module.css';
import type { LineTokens } from './highlight.ts';
import type { DiffLine } from './patch.ts';
import type { FileView, Row } from './rows.ts';
import type { DiffSession, FileTokens } from './session.ts';

type FocusLine = (fileIndex: number, side: CommentSide, line: number) => void;

type DiffRowProps = {
  row: Row;
  fileIndex: number;
  view: FileView;
  tokens: FileTokens | undefined;
  session: DiffSession;
  store: ReviewStore | null;
  expandStep: number;
  /** Absolute path of a local folder, or null for a remote clone (repo-relative links). */
  repoPath: string | null;
  onFocusLine?: FocusLine;
};

export const DiffRow = memo(function DiffRow({
  row,
  fileIndex,
  view,
  tokens,
  session,
  store,
  expandStep,
  repoPath,
  onFocusLine,
}: DiffRowProps) {
  switch (row.kind) {
    case 'file':
      return <FileHeader view={view} fileIndex={fileIndex} session={session} repoPath={repoPath} />;
    case 'line': {
      const anchor = unifiedAnchor(row.line);
      return (
        <div
          className={styles.line}
          data-type={row.line.type}
          onMouseEnter={() => anchor !== null && onFocusLine?.(fileIndex, anchor.side, anchor.line)}
        >
          <NumberCell
            number={row.line.oldNo}
            side="old"
            comment={anchor?.side === 'old' ? anchor.line : null}
            fileIndex={fileIndex}
            session={session}
            onFocusLine={onFocusLine}
          />
          <NumberCell
            number={row.line.newNo}
            side="new"
            comment={anchor?.side === 'new' ? anchor.line : null}
            fileIndex={fileIndex}
            session={session}
            onFocusLine={onFocusLine}
          />
          <Code line={row.line} tokens={lineTokens(tokens, row.line)} />
        </div>
      );
    }
    case 'split':
      return (
        <div className={styles.split}>
          <SplitSide line={row.left} side="old" tokens={tokens} fileIndex={fileIndex} session={session} onFocusLine={onFocusLine} />
          <SplitSide line={row.right} side="new" tokens={tokens} fileIndex={fileIndex} session={session} onFocusLine={onFocusLine} />
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
    case 'thread':
      return store ? <ThreadRow threads={session.threadsOf(row.threadKey)} store={store} /> : null;
    case 'composer':
      return store ? (
        <ComposerRow
          path={view.file.path}
          target={{ side: row.side, line: row.line, startLine: row.startLine }}
          store={store}
          onClose={() => session.closeComposer(fileIndex)}
        />
      ) : null;
  }
});

/** In unified view one row carries both numbers; adding a line is a new-side comment. */
function unifiedAnchor(line: DiffLine): { side: CommentSide; line: number } | null {
  if (line.newNo !== null) {
    return { side: 'new', line: line.newNo };
  }
  if (line.oldNo !== null) {
    return { side: 'old', line: line.oldNo };
  }
  return null;
}

type NumberCellProps = {
  number: number | null;
  side: CommentSide;
  /** Line that gets a `+` on this cell, or `null` when the other side owns the gutter button. */
  comment: number | null;
  fileIndex: number;
  session: DiffSession;
  onFocusLine?: FocusLine;
};

function NumberCell({ number, side, comment, fileIndex, session, onFocusLine }: NumberCellProps) {
  return (
    <span className={styles.number}>
      {number}
      {comment !== null && (
        <button
          type="button"
          className={styles.commentButton}
          aria-label={`Comment on line ${comment}`}
          onFocus={() => onFocusLine?.(fileIndex, side, comment)}
          onClick={(event) => {
            event.stopPropagation();
            session.openComposer(fileIndex, side, comment, event.shiftKey);
          }}
        >
          <Icon name="plus" size={12} />
        </button>
      )}
    </span>
  );
}

function lineTokens(tokens: FileTokens | undefined, line: DiffLine): LineTokens | undefined {
  if (!tokens) {
    return undefined;
  }
  return line.newNo !== null ? tokens.new.get(line.newNo) : line.oldNo !== null ? tokens.old.get(line.oldNo) : undefined;
}

type SplitSideProps = {
  line: DiffLine | null;
  side: CommentSide;
  tokens: FileTokens | undefined;
  fileIndex: number;
  session: DiffSession;
  onFocusLine?: FocusLine;
};

function SplitSide({ line, side, tokens, fileIndex, session, onFocusLine }: SplitSideProps) {
  if (!line) {
    return <div className={styles.half} data-type="empty" />;
  }
  const number = side === 'old' ? line.oldNo : line.newNo;
  const sideTokens = number === null ? undefined : (side === 'old' ? tokens?.old : tokens?.new)?.get(number);
  return (
    <div
      className={styles.half}
      data-type={line.type}
      onMouseEnter={() => number !== null && onFocusLine?.(fileIndex, side, number)}
    >
      <NumberCell number={number} side={side} comment={number} fileIndex={fileIndex} session={session} onFocusLine={onFocusLine} />
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

type FileHeaderProps = { view: FileView; fileIndex: number; session: DiffSession; repoPath: string | null };

export function FileHeader({ view, fileIndex, session, repoPath }: FileHeaderProps) {
  const { file } = view;
  const absolutePath = repoPath === null ? null : `${repoPath}/${file.path}`;
  // A deleted file only exists on the base side, so its header link must use the old template.
  const linkSide = file.status === 'deleted' ? 'old' : 'new';
  const status = STATUS_LABEL[file.status];
  const count = session.commentCount(file.path);
  const canExpand = view.load.status === 'loaded' && !view.collapsed && (file.status === 'modified' || file.status === 'renamed');
  return (
    <div className={`${styles.pinnedWidth} ${styles.fileHeader}`}>
      <IconButton
        icon={view.collapsed ? 'chevronRight' : 'chevronDown'}
        label={view.collapsed ? 'Expand file' : 'Collapse file'}
        aria-expanded={!view.collapsed}
        onClick={() => session.toggleCollapsed(fileIndex)}
      />
      {file.oldPath !== null && <span className={styles.oldPath}>{file.oldPath} → </span>}
      <LineLink path={file.path} side={linkSide} line={null} className={styles.path} />
      {status !== null && (
        <span className={styles.badge} data-status={file.status}>
          {status}
        </span>
      )}
      {count > 0 && (
        <span className={styles.commentCount} title={`${count} ${count === 1 ? 'comment' : 'comments'}`} aria-label={`${count} comments`}>
          <Icon name="comment" size={12} />
          {count}
        </span>
      )}
      <span className={styles.counts}>
        <span className={styles.add}>+{file.additions}</span>
        <span className={styles.del}>−{file.deletions}</span>
      </span>
      <span className={styles.spacer} />
      {canExpand && <IconButton icon="expand" label="Show full file" onClick={() => void session.expandWholeFile(fileIndex)} />}
      {file.status !== 'deleted' && absolutePath !== null && (
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
