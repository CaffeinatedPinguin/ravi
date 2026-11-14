/**
 * One pull request: header, Files changed with local drafts and read-only forge threads, and the
 * Conversation tab. Opening and refreshing both run the server's `open`, which fetches the head.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PullRequestStatusSchema, RepoListSchema } from '../../../shared/api.ts';
import { apiGet, apiSend } from '../../app/api.ts';
import { navigate } from '../../app/router.ts';
import { useSettings } from '../../app/settings.tsx';
import { useAsync } from '../../app/useAsync.ts';
import { Button, IconButton, Segmented, Toggle } from '../../components/controls.tsx';
import { ToastHost } from '../../components/Toast.tsx';
import { MarkdownView } from '../comments/MarkdownView.tsx';
import { ReviewNotes } from '../comments/ReviewNotes.tsx';
import { RemoteThread } from '../comments/Thread.tsx';
import type { DiffViewHandle } from '../diff/DiffView.tsx';
import { DiffSession } from '../diff/session.ts';
import { RepoNav } from '../repos/RepoNav.tsx';
import { DiffMessage, DiffPane } from '../review/DiffPane.tsx';
import { DiffStat } from '../review/DiffStat.tsx';
import page from '../review/ReviewPage.module.css';
import { useReviewStore } from '../review/useReviewStore.ts';
import { LinkModeProvider } from './LinkMode.tsx';
import type { LinkContext } from './links.ts';
import styles from './PullRequestPage.module.css';
import { conversationThreads } from './remoteThreads.ts';
import { PullRequestOpenResponseSchema } from './schemas.ts';
import { pullRequestChanged } from './status.ts';

type PullRequestPageProps = { repoId: string; number: number };

export function PullRequestPage({ repoId, number }: PullRequestPageProps) {
  const { settings, update } = useSettings();
  const repos = useAsync('repos', (signal) => apiGet('/api/repos', RepoListSchema, signal));
  const repo = repos.data?.find((candidate) => candidate.id === repoId);

  const open = useAsync(`open:${repoId}:${number}`, () =>
    apiSend('POST', `/api/repos/${repoId}/pulls/${number}/open`, {}, PullRequestOpenResponseSchema),
  );
  const reloadOpen = open.reload;
  const status = useAsync(`pr-status:${repoId}:${number}`, (signal) =>
    apiGet(`/api/repos/${repoId}/pulls/${number}/status`, PullRequestStatusSchema, signal),
  );
  const reloadStatus = status.reload;
  const refresh = useCallback(() => {
    reloadOpen();
    reloadStatus();
  }, [reloadOpen, reloadStatus]);

  // Poll in the background; a hidden tab does not waste forge calls. A change only raises a banner,
  // never reloads the diff on its own, so the reader's place and drafts stay as they are.
  useEffect(() => {
    const check = () => {
      if (document.visibilityState !== 'hidden') {
        reloadStatus();
      }
    };
    const timer = setInterval(check, 60_000);
    window.addEventListener('focus', check);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', check);
    };
  }, [reloadStatus]);
  useEffect(() => {
    if (open.data !== undefined) {
      reloadStatus();
    }
  }, [open.data, reloadStatus]);

  const target = open.data?.reviewTarget ?? null;
  const { store, version } = useReviewStore(repoId, target);

  // A fresh session per response and whitespace setting; the view mode is applied in place.
  const session = useMemo(
    () =>
      open.data
        ? new DiffSession(
            repoId,
            { target: open.data.diffTarget, ignoreWhitespace: settings.ignoreWhitespace, includeUntracked: false },
            open.data.diffSummary,
            settings.viewMode,
          )
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the response identifies the diff.
    [open.data, settings.ignoreWhitespace],
  );
  useEffect(() => session?.setMode(settings.viewMode), [session, settings.viewMode]);
  useEffect(() => {
    session?.setRemoteThreads(open.data?.threads ?? []);
  }, [session, open.data]);
  useEffect(() => {
    if (session && store) {
      // `version` is the signal that the document changed; the document itself is mutable state.
      void version;
      session.setComments(store.document.comments);
    }
  }, [session, store, version]);

  const linkContext = useMemo<LinkContext>(
    () => ({
      mode: settings.linkMode,
      // A local folder keeps absolute paths; a remote clone is repo-relative.
      repoPath: repo?.kind === 'local' ? repo.path : null,
      urlTemplate: open.data?.fileUrlTemplate ?? null,
      oldUrlTemplate: open.data?.oldFileUrlTemplate ?? null,
    }),
    [settings.linkMode, repo, open.data],
  );

  const diffView = useRef<DiffViewHandle>(null);
  const [activeFile, setActiveFile] = useState(0);
  const [tab, setTab] = useState<'files' | 'conversation'>('files');
  const [notesOpen, setNotesOpen] = useState(false);
  const [previewWidth, setPreviewWidth] = useState<number | null>(null);
  const treeWidth = previewWidth ?? settings.treeWidth;
  const fileCount = open.data?.diffSummary.files.length ?? 0;

  const goToFile = useCallback(
    (fileIndex: number) => {
      if (fileIndex >= 0 && fileIndex < fileCount) {
        diffView.current?.scrollToFile(fileIndex);
      }
    },
    [fileCount],
  );

  // Same keyboard model as the local review; `c` is handled by the diff itself.
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
        refresh();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeFile, goToFile, refresh]);

  const data = open.data;
  const generalCount = store?.document.comments.filter((comment) => comment.path === null).length ?? 0;
  const conversation = data === undefined ? [] : conversationThreads(data.threads);

  return (
    <div className={page.page}>
      <header className={page.topBar}>
        <a
          className={page.brand}
          href="/"
          onClick={(event) => {
            event.preventDefault();
            navigate('/');
          }}
        >
          revu
        </a>
        <RepoNav repoId={repoId} active="pulls" showLocal={repo?.kind !== 'remote'} />
        <span className={styles.repoName}>{repo?.name ?? repoId}</span>
        <span className={page.spacer} />
        <IconButton
          icon={settings.theme === 'dark' || (settings.theme === 'system' && document.documentElement.dataset.theme === 'dark') ? 'sun' : 'moon'}
          label="Switch between light and dark theme"
          onClick={() => update({ theme: document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark' })}
        />
      </header>

      {data !== undefined && (
        <section className={styles.header} aria-labelledby="pr-title">
          <div className={styles.titleRow}>
            <h1 id="pr-title" className={styles.title}>
              <span className={styles.number}>#{data.pullRequest.number}</span> {data.pullRequest.title}
            </h1>
            <span className={styles.state} data-state={data.pullRequest.state}>
              {data.pullRequest.draft ? 'draft' : data.pullRequest.state}
            </span>
            <a href={data.pullRequest.webUrl} target="_blank" rel="noopener noreferrer">
              Open on the forge
            </a>
          </div>
          <p className={styles.byline}>
            <span>{data.pullRequest.author}</span>
            <code className={styles.refs}>
              {data.pullRequest.baseRef} ← {data.pullRequest.headRef}
            </code>
            {data.pullRequest.mergeBaseSha !== null && (
              <code className={styles.sha} title="Merge base used for the diff">
                {data.pullRequest.mergeBaseSha.slice(0, 7)}
              </code>
            )}
          </p>
          {data.warnings.length > 0 && (
            <ul className={styles.warnings} aria-label="Warnings">
              {data.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
        </section>
      )}

      {data !== undefined && pullRequestChanged(data.pullRequest.headSha, status.data) && (
        <div className={styles.banner} role="status">
          <span>This pull request has new commits — Reload</span>
          <Button onClick={refresh}>Reload</Button>
        </div>
      )}

      <div className={page.toolbar}>
        <Segmented
          label="Pull request view"
          value={tab}
          options={[
            { value: 'files', label: 'Files changed' },
            { value: 'conversation', label: 'Conversation' },
          ]}
          onChange={setTab}
        />
        {open.loading && <span className={page.updated}>{data === undefined ? 'Fetching…' : 'Refreshing…'}</span>}
        {data !== undefined && tab === 'files' && (
          <>
            <DiffStat additions={data.diffSummary.additions} deletions={data.diffSummary.deletions} files={fileCount} />
            <span className={page.spacer} />
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
                  disabled: data.fileUrlTemplate === '',
                  title: 'Open files on the forge',
                },
              ]}
              onChange={(linkMode) => update({ linkMode })}
            />
            <IconButton icon="collapse" label="Collapse all files" onClick={() => session?.setAllCollapsed(true)} />
          </>
        )}
        {tab === 'conversation' && <span className={page.spacer} />}
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
        <IconButton
          icon="refresh"
          label="Fetch the pull request again (r)"
          aria-busy={open.loading}
          className={open.loading ? page.refreshing : undefined}
          onClick={refresh}
        />
      </div>

      <div className={styles.body}>
        {open.error !== null && (
          <div className={styles.message} role="alert">
            <p>{open.error}</p>
            <Button onClick={refresh}>Try again</Button>
          </div>
        )}
        {open.error === null && data === undefined && <DiffMessage>Fetching pull request…</DiffMessage>}
        {data !== undefined && tab === 'files' && (
          <>
            {fileCount === 0 && <DiffMessage>This pull request changes no files.</DiffMessage>}
            {session !== null && store !== null && fileCount > 0 && (
              <div className={page.body} style={{ gridTemplateColumns: `${treeWidth}px 5px 1fr` }}>
                <LinkModeProvider context={linkContext}>
                  <DiffPane
                    session={session}
                    store={store}
                    repoPath={repo?.kind === 'local' ? repo.path : null}
                    treeWidth={treeWidth}
                    activeFile={activeFile}
                    mode={settings.viewMode}
                    expandStep={settings.expandStep}
                    commentCount={(path) => store.commentCounts().get(path) ?? 0}
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
              </div>
            )}
          </>
        )}
        {data !== undefined && tab === 'conversation' && (
          <div className={styles.conversation}>
            {notesOpen && store !== null && <ReviewNotes store={store} onClose={() => setNotesOpen(false)} />}
            <section className={styles.description} aria-labelledby="pr-description">
              <h2 id="pr-description">Description</h2>
              {data.pullRequest.body.trim() === '' ? (
                <p className={styles.muted}>The author wrote no description.</p>
              ) : (
                <MarkdownView body={data.pullRequest.body} />
              )}
            </section>
            <section aria-labelledby="pr-threads">
              <h2 id="pr-threads">Conversation</h2>
              {conversation.length === 0 ? (
                <p className={styles.muted}>No pull request level comments yet.</p>
              ) : (
                <div className={styles.threads}>
                  {conversation.map((thread) => (
                    <RemoteThread key={thread.id} thread={thread} />
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
      <ToastHost />
    </div>
  );
}
