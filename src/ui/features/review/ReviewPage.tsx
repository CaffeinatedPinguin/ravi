/** The review screen for one repository: top bar, review toolbar, file tree and the diff. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DiffSummarySchema, RepoInfoSchema, RepoListSchema } from '../../../shared/api.ts';
import type { DiffOptions, DiffTarget } from '../../../shared/api.ts';
import { apiGet, apiSend } from '../../app/api.ts';
import { navigate } from '../../app/router.ts';
import { useSettings } from '../../app/settings.tsx';
import { useAsync } from '../../app/useAsync.ts';
import { Button, IconButton, Segmented, Toggle } from '../../components/controls.tsx';
import { DiffView } from '../diff/DiffView.tsx';
import type { DiffViewHandle } from '../diff/DiffView.tsx';
import { FileTree } from '../diff/FileTree.tsx';
import { DiffSession } from '../diff/session.ts';
import { DiffStat } from './DiffStat.tsx';
import styles from './ReviewPage.module.css';
import { TargetPicker } from './TargetPicker.tsx';
import { decodeTarget, encodeTarget, showsWorkingTree } from './target.ts';
import { TreeResizer } from './TreeResizer.tsx';
import { formatUpdatedAgo, useAutoRefresh } from './useAutoRefresh.ts';

type ReviewPageProps = { repoId: string; targetParam: string | null };

export function ReviewPage({ repoId, targetParam }: ReviewPageProps) {
  const { settings, update } = useSettings();
  const target = useMemo(() => decodeTarget(targetParam), [targetParam]);
  const options: DiffOptions = useMemo(
    () => ({ target, ignoreWhitespace: settings.ignoreWhitespace, includeUntracked: settings.showUntracked && showsWorkingTree(target) }),
    [target, settings.ignoreWhitespace, settings.showUntracked],
  );
  const optionsKey = JSON.stringify(options);

  const repos = useAsync('repos', (signal) => apiGet('/api/repos', RepoListSchema, signal));
  const info = useAsync(`info:${repoId}`, (signal) => apiGet(`/api/repos/${repoId}/info`, RepoInfoSchema, signal));
  const summary = useAsync(`diff:${repoId}:${optionsKey}`, () => apiSend('POST', `/api/repos/${repoId}/diff`, options, DiffSummarySchema));

  const repo = repos.data?.find((candidate) => candidate.id === repoId);
  const reloadSummary = summary.reload;
  // A new session per loaded summary: switching target or repository starts from a clean slate.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the summary identifies repository and options.
  const session = useMemo(() => (summary.data ? new DiffSession(repoId, options, summary.data, settings.viewMode) : null), [summary.data]);
  useEffect(() => session?.setMode(settings.viewMode), [session, settings.viewMode]);

  const diffView = useRef<DiffViewHandle>(null);
  const [activeFile, setActiveFile] = useState(0);
  const fileCount = summary.data?.files.length ?? 0;

  // The last load is the moment the "updated N s ago" label counts from.
  const updatedAt = useAutoRefresh({ repoId, target, loaded: summary.data, onReload: summary.reload });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);

  // While dragging, the grid follows a local width; it is written to settings only on release.
  const [previewWidth, setPreviewWidth] = useState<number | null>(null);
  const treeWidth = previewWidth ?? settings.treeWidth;

  const setTarget = (next: DiffTarget) => navigate(`/repo/${repoId}?t=${encodeURIComponent(encodeTarget(next))}`);
  const goToFile = useCallback(
    (fileIndex: number) => {
      if (fileIndex >= 0 && fileIndex < fileCount) {
        diffView.current?.scrollToFile(fileIndex);
      }
    },
    [fileCount],
  );

  // j / k step through files, as in most review tools; r reloads without reaching for the mouse.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable]');
      if (typing || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      if (event.key === 'j') {
        goToFile(activeFile + 1);
      } else if (event.key === 'k') {
        goToFile(activeFile - 1);
      } else if (event.key === 'r' && !event.repeat) {
        reloadSummary();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeFile, goToFile, reloadSummary]);

  return (
    <div className={styles.page}>
      <header className={styles.topBar}>
        <a
          className={styles.brand}
          href="/"
          onClick={(event) => {
            event.preventDefault();
            navigate('/');
          }}
        >
          revu
        </a>
        <select
          aria-label="Repository"
          className={styles.repoSelect}
          value={repoId}
          onChange={(event) => navigate(`/repo/${event.target.value}`)}
        >
          {repos.data?.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name}
            </option>
          ))}
        </select>
        {info.data?.branch && ( <span className={styles.branch}>{info.data.branch}</span>)}
        <TargetPicker key={encodeTarget(target)} target={target} info={info.data} onChange={setTarget} />
        <span className={styles.spacer} />
        <IconButton
          icon={document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon'}
          label="Switch between light and dark theme"
          onClick={() => update({ theme: document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark' })}
        />
      </header>

      <div className={styles.toolbar}>
        {summary.data && <DiffStat additions={summary.data.additions} deletions={summary.data.deletions} files={fileCount} />}
        <span className={styles.spacer} />
        {showsWorkingTree(target) && (
          <Toggle checked={settings.showUntracked} onChange={(showUntracked) => update({ showUntracked })}>
            Untracked files
          </Toggle>
        )}
        <Toggle checked={settings.ignoreWhitespace} onChange={(ignoreWhitespace) => update({ ignoreWhitespace })}>
          Hide whitespace
        </Toggle>
        <Segmented
          label="Diff layout"
          value={settings.viewMode}
          options={[
            { value: 'unified', label: 'Unified', icon: 'unified' },
            { value: 'split', label: 'Split', icon: 'split' },
          ]}
          onChange={(viewMode) => update({ viewMode })}
        />
        <IconButton icon="collapse" label="Collapse all files" onClick={() => session?.setAllCollapsed(true)} />
        <span className={styles.updated} aria-live="polite">
          {updatedAt !== null && formatUpdatedAgo(now, updatedAt)}
        </span>
        <IconButton
          icon="refresh"
          label="Reload changes (r)"
          aria-busy={summary.loading}
          className={summary.loading ? styles.refreshing : undefined}
          onClick={summary.reload}
        />
      </div>

      <div className={styles.body} style={{ gridTemplateColumns: `${treeWidth}px 5px 1fr` }}>
        {summary.error !== null && (
          <div className={styles.message} role="alert">
            <p>{summary.error}</p>
            <Button onClick={summary.reload}>Try again</Button>
          </div>
        )}
        {summary.error === null && !session && <div className={styles.message}>Loading changes…</div>}
        {session && fileCount === 0 && (
          <div className={styles.message}>
            <p>No changes to review here.</p>
            <p className={styles.hint}>Pick another comparison above, or make some changes and reload.</p>
          </div>
        )}
        {session && fileCount > 0 && (
          <>
            <FileTree files={session.files} activeFile={activeFile} onSelect={goToFile} />
            <TreeResizer
              width={treeWidth}
              onChange={setPreviewWidth}
              onCommit={(width) => {
                setPreviewWidth(null);
                update({ treeWidth: width });
              }}
            />
            <DiffView
              key={session.id}
              ref={diffView}
              session={session}
              mode={settings.viewMode}
              expandStep={settings.expandStep}
              repoPath={repo?.path ?? ''}
              onActiveFileChange={setActiveFile}
            />
          </>
        )}
      </div>
    </div>
  );
}
