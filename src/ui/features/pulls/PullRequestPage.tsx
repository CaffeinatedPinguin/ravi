/**
 * One pull request: header, Files changed with local drafts and read-only forge threads, and the
 * Conversation tab. Opening and refreshing both run the server's `open`, which fetches the head.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PullRequestStatusSchema, RepoListSchema } from '../../../shared/api.ts';
import type { ReviewAction } from '../../../shared/forge.ts';
import type { ReviewDocument } from '../../../shared/review.ts';
import { apiGet, apiSend, ApiError } from '../../app/api.ts';
import { useSettings } from '../../app/settings.tsx';
import { useAsync } from '../../app/useAsync.ts';
import { Brand } from '../../components/Brand.tsx';
import { Button, IconButton, Segmented, Toggle } from '../../components/controls.tsx';
import { ShortcutsDialog } from '../../components/ShortcutsDialog.tsx';
import type { Shortcut } from '../../components/ShortcutsDialog.tsx';
import { showToast } from '../../components/Toast.tsx';
import { TopBarActions } from '../../components/TopBarActions.tsx';
import { ComposerCapabilitiesContext } from '../comments/ComposerContext.ts';
import { MarkdownView } from '../comments/MarkdownView.tsx';
import { isRemoteDraft } from '../comments/remoteDrafts.ts';
import { ReviewNotes } from '../comments/ReviewNotes.tsx';
import { SendActionsProvider } from '../comments/SendContext.ts';
import { RemoteThread } from '../comments/Thread.tsx';
import type { DiffViewHandle } from '../diff/DiffView.tsx';
import { DiffSession } from '../diff/session.ts';
import { RepoNav } from '../repos/RepoNav.tsx';
import threadStyles from '../notifications/Notifications.module.css';
import { useThreadScroll } from '../notifications/useThreadScroll.ts';
import { DiffMessage, DiffPane } from '../review/DiffPane.tsx';
import { DiffStat } from '../review/DiffStat.tsx';
import page from '../review/ReviewPage.module.css';
import { useReviewStore } from '../review/useReviewStore.ts';
import { LinkModeProvider } from './LinkMode.tsx';
import type { LinkContext } from './links.ts';
import styles from './PullRequestPage.module.css';
import { conversationThreads } from './remoteThreads.ts';
import { PullRequestOpenResponseSchema, SendResponseSchema } from './schemas.ts';
import { SendControls, SendDialog } from './SendControls.tsx';
import type { VerdictFailure } from './sendPlan.ts';
import {
  approveDisabledReason,
  buildSendPlan,
  countDrafts,
  nextVerdictFailure,
  retryVerdictLabel,
  targetLabel,
  verdictFailureTitle,
  verdictLabel,
} from './sendPlan.ts';
import { pullRequestChanged } from './status.ts';

type PullRequestPageProps = { repoId: string; number: number };

const FILE_SHORTCUTS: readonly Shortcut[] = [
  { keys: 'j / k', description: 'Next / previous file' },
  { keys: 'r', description: 'Refresh the pull request' },
  { keys: 'c', description: 'Comment on the focused line' },
  { keys: 'Ctrl/Cmd + Shift + Enter', description: 'Open the send confirmation' },
  { keys: '?', description: 'Show this dialog' },
];

const CONVERSATION_SHORTCUTS: readonly Shortcut[] = [
  { keys: 'j / k', description: 'Next / previous file' },
  { keys: 'r', description: 'Refresh the pull request' },
  { keys: 'Ctrl/Cmd + Shift + Enter', description: 'Open the send confirmation' },
  { keys: '?', description: 'Show this dialog' },
];

/** Used only to build an empty confirmation plan before the document loads; never sent. */
const EMPTY_DOCUMENT: ReviewDocument = {
  version: 1,
  target: { kind: 'local', repoPath: '', target: '' },
  baseSha: null,
  headSha: null,
  action: null,
  summary: null,
  comments: [],
};

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

  // `scrollToRow` is the API this page needs from the virtualizer; the hook falls back to opening
  // the file when the session has no matching row yet.
  const diffView = useRef<DiffViewHandle>(null);
  const readDiffHandle = useCallback(() => diffView.current, []);
  const [activeFile, setActiveFile] = useState(0);
  const [tab, setTab] = useState<'files' | 'conversation'>('files');
  const [notesOpen, setNotesOpen] = useState(false);
  const [previewWidth, setPreviewWidth] = useState<number | null>(null);
  const [sendAction, setSendAction] = useState<ReviewAction | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [verdictFailure, setVerdictFailure] = useState<VerdictFailure | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [approved, setApproved] = useState(false);
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
  useThreadScroll(open.data?.threads ?? [], tab, setTab, { session, handle: readDiffHandle });

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
  const reviewDocument = store?.document ?? null;
  const draftCounts = countDrafts(reviewDocument?.comments ?? []);
  const generalCount =
    reviewDocument?.comments.filter((comment) => comment.path === null && !isRemoteDraft(comment)).length ?? 0;
  const conversation = data === undefined ? [] : conversationThreads(data.threads);
  const sendTarget =
    data !== undefined && data.reviewTarget.kind === 'pullRequest'
      ? targetLabel(data.reviewTarget.project, data.reviewTarget.number, data.reviewTarget.host)
      : '';
  const host = data !== undefined && data.reviewTarget.kind === 'pullRequest' ? data.reviewTarget.host : '';
  const plan = buildSendPlan(reviewDocument ?? EMPTY_DOCUMENT, sendTarget, sendAction, reviewDocument?.summary ?? null);
  const approveReason =
    data === undefined || reviewDocument === null
      ? 'The pull request is still loading'
      : approveDisabledReason(data.pullRequest, data.currentUser);

  const openSend = useCallback((action: ReviewAction) => {
    setSendError(null);
    setConflict(null);
    setSendAction(action);
  }, []);
  const closeSend = useCallback(() => {
    if (!sending) {
      setSendAction(null);
      setConflict(null);
      setSendError(null);
    }
  }, [sending]);

  /**
   * The only place the page writes to the forge. The result replaces the document (successful
   * drafts are gone, failures carry `sendError`) and the threads are re-read so pending changes
   * change into real forge comments.
   */
  const submitSend = async (action: ReviewAction, force: boolean) => {
    if (store === null) {
      return;
    }
    setSending(true);
    setSendError(null);
    setConflict(null);
    try {
      const response = await apiSend(
        'POST',
        `/api/repos/${repoId}/pulls/${number}/send`,
        { action, summary: store.document.summary, force },
        SendResponseSchema,
      );
      store.applyServerDocument(response.document);
      void open.reload();
      setSendAction(null);
      setVerdictFailure((current) => nextVerdictFailure(current, response.approval));
      const ok = response.results.filter((result) => result.ok).length;
      const failed = response.results.length - ok;
      const verdict =
        response.approval === null
          ? ''
          : response.approval.ok
            ? ` · ${verdictLabel(response.approval.action)} sent`
            : ` · ${verdictLabel(response.approval.action)} failed`;
      showToast({ message: `Sent: ${ok} ok, ${failed} failed${verdict}` }, 7000);
      if (response.approval?.ok === true && response.approval.action === 'approve') {
        setApproved(true);
      }
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 409) {
        setConflict('This pull request has new commits since you opened it');
      } else {
        setSendError(reason instanceof Error ? reason.message : 'Could not send the review');
      }
    } finally {
      setSending(false);
    }
  };

  /** Failed drafts stay in the document; the server sends only those on the next request. */
  const retryFailed = async () => {
    if (store === null) {
      return;
    }
    setSending(true);
    try {
      const response = await apiSend(
        'POST',
        `/api/repos/${repoId}/pulls/${number}/send`,
        { action: null, summary: null, force: true },
        SendResponseSchema,
      );
      store.applyServerDocument(response.document);
      void open.reload();
      const ok = response.results.filter((result) => result.ok).length;
      const failed = response.results.length - ok;
      showToast({ message: `Retry: ${ok} ok, ${failed} failed` }, 6000);
    } catch (reason) {
      showToast({ message: reason instanceof Error ? reason.message : 'Retry failed' }, 6000);
    } finally {
      setSending(false);
    }
  };

  /**
   * Sends only the verdict again. `force` is safe here: the user saw the original failure and is
   * explicitly retrying, and a head change keeps its own conflict handling on the normal send path.
   */
  const retryVerdict = async () => {
    if (store === null || verdictFailure === null) {
      return;
    }
    setSending(true);
    try {
      const response = await apiSend(
        'POST',
        `/api/repos/${repoId}/pulls/${number}/send`,
        { action: verdictFailure.action, summary: store.document.summary, force: true },
        SendResponseSchema,
      );
      store.applyServerDocument(response.document);
      void open.reload();
      setVerdictFailure((current) => nextVerdictFailure(current, response.approval));
      if (response.approval?.ok === true && response.approval.action === 'approve') {
        setApproved(true);
      }
      showToast(
        {
          message:
            response.approval?.ok === true
              ? `${verdictLabel(verdictFailure.action)} sent`
              : `${verdictLabel(verdictFailure.action)} failed again`,
        },
        6000,
      );
    } catch (reason) {
      showToast({ message: reason instanceof Error ? reason.message : 'Retry failed' }, 6000);
    } finally {
      setSending(false);
    }
  };

  const sendActions = { retry: () => void retryFailed() };
  const composerCapabilities = {
    imageUpload: data?.capabilities.imageUpload ?? true,
    threadedPrComments: data?.capabilities.threadedPrComments ?? true,
  };

  return (
    <div className={page.page}>
      <header className={page.topBar}>
        <Brand />
        <RepoNav repoId={repoId} active="pulls" showLocal={repo?.kind !== 'remote'} />
        <span className={styles.repoName}>{repo?.name ?? repoId}</span>
        <span className={page.spacer} />
        <IconButton
          icon={settings.theme === 'dark' || (settings.theme === 'system' && document.documentElement.dataset.theme === 'dark') ? 'sun' : 'moon'}
          label="Switch between light and dark theme"
          onClick={() => update({ theme: document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark' })}
        />
        <TopBarActions />
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
            {approved && <span className={styles.approved}>Approved by you</span>}
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

      {verdictFailure !== null && (
        <div className={styles.verdictNotice} role="alert">
          <span>
            <strong>{verdictFailureTitle(verdictFailure)}:</strong> {verdictFailure.error}
          </span>
          <span className={page.spacer} />
          <Button onClick={() => void retryVerdict()} disabled={sending}>
            {retryVerdictLabel(verdictFailure.action)}
          </Button>
          <IconButton icon="close" label="Dismiss the verdict error" onClick={() => setVerdictFailure(null)} />
        </div>
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
        {data !== undefined && store !== null && (
          <SendControls
            count={draftCounts.total}
            canSend={draftCounts.total > 0 || (reviewDocument?.summary ?? '').trim() !== ''}
            approveDisabledReason={approveReason}
            requestChanges={data.capabilities.requestChanges}
            onApprove={() => openSend('approve')}
            onOpen={openSend}
          />
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
        <SendActionsProvider value={sendActions}>
          <ComposerCapabilitiesContext.Provider value={composerCapabilities}>
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
                      {store !== null &&
                        conversation.map((thread) => (
                          <div key={thread.id} id={`thread-${thread.id}`} className={threadStyles.threadAnchor}>
                            <RemoteThread thread={thread} store={store} />
                          </div>
                        ))}
                    </div>
                  )}
                </section>
              </div>
            )}
          </ComposerCapabilitiesContext.Provider>
        </SendActionsProvider>
      </div>
      {data !== undefined && store !== null && (
        <SendDialog
          open={sendAction !== null}
          plan={plan}
          host={host}
          sending={sending}
          conflict={conflict}
          error={sendError}
          onClose={closeSend}
          onSummaryChange={(summary) => store.setSummary(summary)}
          onConfirm={(force) => {
            if (sendAction !== null) {
              void submitSend(sendAction, force);
            }
          }}
          onReload={() => {
            setSendAction(null);
            setConflict(null);
            refresh();
          }}
        />
      )}
      <ShortcutsDialog shortcuts={tab === 'files' ? FILE_SHORTCUTS : CONVERSATION_SHORTCUTS} />
    </div>
  );
}
