/** The review screen for one repository: top bar, review toolbar, file tree and the diff. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { DiffSummarySchema, RefsSchema, RepoInfoSchema, RepoListSchema, ReviewExportResponseSchema } from '../../../shared/api.ts';
import type { DiffOptions, DiffTarget } from '../../../shared/api.ts';
import type { ReviewDocument, ReviewTarget } from '../../../shared/review.ts';
import { apiGet, apiSend } from '../../app/api.ts';
import { navigate } from '../../app/router.ts';
import { useSettings } from '../../app/settings.tsx';
import { useAsync } from '../../app/useAsync.ts';
import { Brand } from '../../components/Brand.tsx';
import { Combobox } from '../../components/Combobox.tsx';
import { Button, IconButton, Segmented, Toggle } from '../../components/controls.tsx';
import { ShortcutsDialog } from '../../components/ShortcutsDialog.tsx';
import { showToast, ToastHost } from '../../components/Toast.tsx';
import { TopBarActions } from '../../components/TopBarActions.tsx';
import { downloadMarkdown, reviewFileName } from '../comments/download.ts';
import { isImportableFile, readImportFile } from '../comments/importFile.ts';
import { ImportDialog } from '../comments/ImportDialog.tsx';
import { ReviewNotes } from '../comments/ReviewNotes.tsx';
import type { DiffViewHandle } from '../diff/DiffView.tsx';
import { DiffSession } from '../diff/session.ts';
import { LinkModeProvider } from '../pulls/LinkMode.tsx';
import type { LinkContext } from '../pulls/links.ts';
import { FileUrlTemplateSchema } from '../pulls/schemas.ts';
import { RepoNav } from '../repos/RepoNav.tsx';
import { DiffMessage, DiffPane } from './DiffPane.tsx';
import { DiffStat } from './DiffStat.tsx';
import styles from './ReviewPage.module.css';
import { LOCAL_REVIEW_SHORTCUTS } from './shortcuts.ts';
import { TargetPicker } from './TargetPicker.tsx';
import { decodeTarget, encodeTarget, showsWorkingTree } from './target.ts';
import { formatUpdatedAgo, useAutoRefresh } from './useAutoRefresh.ts';
import { useReviewStore } from './useReviewStore.ts';

type ImportSeed = { markdown: string; fileName: string };

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
  const refs = useAsync(`refs:${repoId}`, (signal) => apiGet(`/api/repos/${repoId}/refs`, RefsSchema, signal));
  const summary = useAsync(`diff:${repoId}:${optionsKey}`, () => apiSend('POST', `/api/repos/${repoId}/diff`, options, DiffSummarySchema));

  const repo = repos.data?.find((candidate) => candidate.id === repoId);
  const reloadSummary = summary.reload;
  // A new session per loaded summary: switching target or repository starts from a clean slate.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the summary identifies repository and options.
  const session = useMemo(() => (summary.data ? new DiffSession(repoId, options, summary.data, settings.viewMode) : null), [summary.data]);
  useEffect(() => session?.setMode(settings.viewMode), [session, settings.viewMode]);

  // One store per review target. The server route may not exist yet in this worktree; tests mock it.
  const repoPath = repo?.path;
  const reviewTarget = useMemo<ReviewTarget | null>(
    () => (repoPath === undefined ? null : { kind: 'local', repoPath, target: encodeTarget(target) }),
    [repoPath, target],
  );
  const { store, version: storeVersion } = useReviewStore(repoId, reviewTarget);
  useEffect(() => {
    if (session && store) {
      // `storeVersion` is the signal that the document changed; the document itself is mutable state.
      void storeVersion;
      session.setComments(store.document.comments);
    }
  }, [session, store, storeVersion]);
  // The store caches per-file counts until the document itself changes, so the tree badge is
  // current in the same render as the mutation without walking every comment on scroll.
  const commentCounts = store?.commentCounts();

  // URL links need a forge remote and a commit; the server builds the template. Without them the
  // toggle stays on path mode and every link still copies a usable `path:line`.
  const urlAvailable = repo?.remote !== null && repo?.remote !== undefined;
  const wantsUrl = settings.linkMode === 'url' && urlAvailable;
  const fileUrl = useAsync(
    `file-url:${repoId}:${wantsUrl ? '1' : '0'}`,
    (signal) =>
      wantsUrl
        ? apiGet(`/api/repos/${repoId}/file-url-template?sha=HEAD`, FileUrlTemplateSchema, signal)
        : Promise.resolve(null),
  );
  const linkContext = useMemo<LinkContext>(
    () => ({
      mode: settings.linkMode,
      repoPath: repo?.kind === 'local' ? repo.path : null,
      urlTemplate: fileUrl.data?.fileUrlTemplate ?? null,
      oldUrlTemplate: fileUrl.data?.oldFileUrlTemplate ?? null,
    }),
    [settings.linkMode, repo?.kind, repo?.path, fileUrl.data],
  );

  const diffView = useRef<DiffViewHandle>(null);
  const [activeFile, setActiveFile] = useState(0);
  const fileCount = summary.data?.files.length ?? 0;

  // Review-level UI state: the notes panel and the import dialog (with text read from a drop).
  const [notesOpen, setNotesOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importSeed, setImportSeed] = useState<ImportSeed | null>(null);
  const [importKey, setImportKey] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  const openImport = useCallback((seed: ImportSeed | null = null) => {
    setImportSeed(seed);
    setImportKey((value) => value + 1);
    setImportOpen(true);
  }, []);
  const closeImport = useCallback(() => {
    setImportOpen(false);
    setImportSeed(null);
  }, []);
  const applyImport = useCallback(
    (document: ReviewDocument) => {
      if (!store) {
        return;
      }
      const undo = store.replaceDocument(document);
      closeImport();
      showToast({ message: 'Review imported', action: { label: 'Undo', onClick: undo } }, 8000);
    },
    [store, closeImport],
  );

  const dropImport = useCallback(
    async (file: File) => {
      try {
        const markdown = await readImportFile(file);
        openImport({ markdown, fileName: file.name });
      } catch (reason) {
        showToast({ message: reason instanceof Error ? reason.message : 'Could not read the file' });
      }
    },
    [openImport],
  );

  const hasFiles = (event: DragEvent<HTMLDivElement>) => event.dataTransfer.types.includes('Files');
  const onDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!hasFiles(event)) {
      return;
    }
    event.preventDefault();
    dragDepth.current += 1;
    setDragging(true);
  };
  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!hasFiles(event)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  };
  const onDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!hasFiles(event)) {
      return;
    }
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) {
      setDragging(false);
    }
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    // Always stop the browser from navigating to the dropped file.
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const file = event.dataTransfer.files[0];
    // Image drops belong to the comment composer; only a review text file opens the import dialog.
    if (file && isImportableFile(file)) {
      void dropImport(file);
    }
  };

  const repoName = repo?.name ?? repoId;
  const hasContent = store !== null && (store.document.comments.length > 0 || (store.document.summary ?? '').trim() !== '');
  const generalCount = store?.document.comments.filter((comment) => comment.path === null).length ?? 0;

  const exportReview = useCallback(async (): Promise<{ markdown: string; count: number } | null> => {
    if (!store) {
      return null;
    }
    const document = store.document;
    const { markdown } = await apiSend(
      'POST',
      '/api/reviews/export',
      { repoId, diffTarget: target, document },
      ReviewExportResponseSchema,
    );
    return { markdown, count: document.comments.length };
  }, [store, repoId, target]);

  const copyReview = useCallback(async () => {
    if (!hasContent) {
      return;
    }
    try {
      const exported = await exportReview();
      if (!exported) {
        return;
      }
      await navigator.clipboard.writeText(exported.markdown);
      showToast({ message: `Copied ${exported.count} ${exported.count === 1 ? 'comment' : 'comments'} for AI` });
    } catch (reason) {
      showToast({ message: reason instanceof Error ? reason.message : 'Could not copy the review' });
    }
  }, [hasContent, exportReview]);

  const saveReview = useCallback(async () => {
    if (!hasContent) {
      return;
    }
    try {
      const exported = await exportReview();
      if (!exported) {
        return;
      }
      downloadMarkdown(reviewFileName(repoName, encodeTarget(target)), exported.markdown);
    } catch (reason) {
      showToast({ message: reason instanceof Error ? reason.message : 'Could not save the review' });
    }
  }, [hasContent, exportReview, repoName, target]);

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
  // Shift+C / Shift+S / Shift+I are the Markdown transfer actions.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable]');
      if (typing || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      const key = event.key.toLowerCase();
      if (event.shiftKey) {
        if (event.repeat) {
          return;
        }
        if (key === 'c') {
          event.preventDefault();
          void copyReview();
        } else if (key === 's') {
          event.preventDefault();
          void saveReview();
        } else if (key === 'i' && !importOpen) {
          event.preventDefault();
          openImport();
        }
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
  }, [activeFile, goToFile, reloadSummary, copyReview, saveReview, openImport, importOpen]);

  return (
    <div
      className={styles.page}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <header className={styles.topBar}>
        <Brand />
        <RepoNav repoId={repoId} active="local" showLocal={repo?.kind !== 'remote'} />
        <Combobox
          label="Repository"
          className={styles.repoSelect}
          value={repoId}
          options={(repos.data ?? []).map((candidate) => ({
            value: candidate.id,
            label: candidate.name,
            detail: candidate.path,
          }))}
          onChange={(id) => navigate(`/repo/${id}`)}
        />
        {info.data?.branch && ( <span className={styles.branch}>{info.data.branch}</span>)}
        <TargetPicker key={encodeTarget(target)} target={target} info={info.data} refs={refs.data} onChange={setTarget} />
        <span className={styles.spacer} />
        <IconButton
          icon={document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon'}
          label="Switch between light and dark theme"
          onClick={() => update({ theme: document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark' })}
        />
        <TopBarActions />
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
        <Segmented
          label="Link mode"
          value={settings.linkMode}
          options={[
            { value: 'path', label: 'Path' },
            {
              value: 'url',
              label: 'URL',
              disabled: !urlAvailable,
              title: urlAvailable ? 'Open files on the forge' : 'Connect a GitHub or GitLab remote to use forge URLs',
            },
          ]}
          onChange={(linkMode) => update({ linkMode })}
        />
        <IconButton icon="collapse" label="Collapse all files" onClick={() => session?.setAllCollapsed(true)} />
        <span className={styles.updated} aria-live="polite">
          {updatedAt !== null && formatUpdatedAgo(now, updatedAt)}
        </span>
        {store && (
          <Button
            aria-expanded={notesOpen}
            aria-controls="review-notes"
            title="Show or hide review notes"
            onClick={() => setNotesOpen((value) => !value)}
          >
            Notes ({generalCount})
          </Button>
        )}
        {store && (
          <div className={styles.transfer} role="group" aria-label="Review Markdown">
            <Button icon="upload" title="Import review Markdown (Shift+I)" onClick={() => openImport()}>
              Import
            </Button>
            <Button icon="copy" title="Copy review Markdown for AI (Shift+C)" disabled={!hasContent} onClick={() => void copyReview()}>
              Copy
            </Button>
            <Button icon="download" title="Save review Markdown (Shift+S)" disabled={!hasContent} onClick={() => void saveReview()}>
              Save
            </Button>
          </div>
        )}
        {store && <SaveStatus status={store.saveStatus} onRetry={() => void store.retry()} />}
        <IconButton
          icon="refresh"
          label="Reload changes (r)"
          aria-busy={summary.loading}
          className={summary.loading ? styles.refreshing : undefined}
          onClick={summary.reload}
        />
      </div>

      {store && notesOpen && <ReviewNotes store={store} onClose={() => setNotesOpen(false)} />}

      <div className={styles.body} style={{ gridTemplateColumns: `${treeWidth}px 5px 1fr` }}>
        {summary.error !== null && (
          <div className={styles.message} role="alert">
            <p>{summary.error}</p>
            <Button onClick={summary.reload}>Try again</Button>
          </div>
        )}
        {summary.error === null && !session && <DiffMessage>Loading changes…</DiffMessage>}
        {session && fileCount === 0 && (
          <DiffMessage>
            <p>No changes to review here.</p>
            <p className={styles.hint}>Pick another comparison above, or make some changes and reload.</p>
          </DiffMessage>
        )}
        {session && store && fileCount > 0 && (
          <LinkModeProvider context={linkContext}>
            <DiffPane
              session={session}
              store={store}
              repoPath={repo?.kind === 'local' ? repo.path : null}
              treeWidth={treeWidth}
              activeFile={activeFile}
              mode={settings.viewMode}
              expandStep={settings.expandStep}
              commentCount={(path) => commentCounts?.get(path) ?? 0}
              onSelectFile={goToFile}
              onActiveFileChange={setActiveFile}
              onResize={setPreviewWidth}
              onCommitWidth={(width) => {
                setPreviewWidth(null);
                update({ treeWidth: width });
              }}
              viewRef={diffView}
            />
          </LinkModeProvider>
        )}
      </div>
      {dragging && (
        <div className={styles.dropOverlay} aria-hidden="true">
          Drop a .md or .txt file to import a review
        </div>
      )}
      {store && importOpen && (
        <ImportDialog
          key={importKey}
          repoId={repoId}
          diffTarget={target}
          currentDocument={store.document}
          initialMarkdown={importSeed?.markdown ?? ''}
          onClose={closeImport}
          onApply={applyImport}
        />
      )}
      <ShortcutsDialog shortcuts={LOCAL_REVIEW_SHORTCUTS} />
      <ToastHost />
    </div>
  );
}

function SaveStatus({ status, onRetry }: { status: 'saved' | 'saving' | 'error'; onRetry: () => void }) {
  if (status === 'error') {
    return (
      <button type="button" className={styles.saveError} onClick={onRetry}>
        Save failed — retry
      </button>
    );
  }
  return (
    <span className={styles.saveStatus} data-status={status} aria-live="polite">
      {status === 'saving' ? 'Saving…' : 'Saved'}
    </span>
  );
}
