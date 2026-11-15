/** Inline threads under a commented line: local drafts, forge threads and their actions. */
import { useState } from 'react';
import type { Thread } from '../../../shared/forge.ts';
import type { ReviewComment } from '../../../shared/review.ts';
import { showToast } from '../../components/Toast.tsx';
import { LineLink } from '../pulls/LinkMode.tsx';
import { Composer } from './Composer.tsx';
import { useComposerCapabilities } from './ComposerContext.ts';
import styles from './Comments.module.css';
import { MarkdownView } from './MarkdownView.tsx';
import { remoteDraftState } from './remoteDrafts.ts';
import type { ReviewStore } from './reviewStore.ts';
import { useSendActions } from './SendContext.ts';
import type { CommentThread } from './threads.ts';
import { isOutsideThreadKey, relativeTime } from './threads.ts';

type ThreadRowProps = { threads: readonly CommentThread[]; store: ReviewStore; reviewLevel?: boolean };

export function ThreadRow({ threads, store, reviewLevel = false }: ThreadRowProps) {
  if (threads.length === 0) {
    return reviewLevel ? <p className={styles.noComments}>No general comments yet.</p> : null;
  }
  const outside = !reviewLevel && isOutsideThreadKey(threads[0]?.key ?? '');
  return (
    <div className={reviewLevel ? styles.notesThreads : styles.threads}>
      {outside && <p className={styles.outside}>Comments outside the shown lines</p>}
      {threads.map((thread) => (
        <section
          // Several outside threads share one key; the forge id keeps React's list stable.
          key={thread.remote?.id ?? thread.key}
          // Notification links land on `thread-<forge id>`; tabIndex lets the hook focus it after the
          // virtualizer scrolls the row into view.
          id={thread.remote === undefined ? undefined : `thread-${thread.remote.id}`}
          tabIndex={thread.remote === undefined ? undefined : -1}
          className={reviewLevel ? `${styles.thread} ${styles.noteThread}` : styles.thread}
          aria-label={
            reviewLevel
              ? 'General comments'
              : `Comments on line ${thread.startLine === null ? thread.line : `${thread.startLine}-${thread.line}`}`
          }
        >
          {!reviewLevel && thread.startLine !== null && (
            <p className={styles.range}>
              Lines {thread.startLine}–{thread.line}
            </p>
          )}
          {thread.remote !== undefined && <RemoteThread thread={thread.remote} store={store} />}
          {thread.comments.map((comment) => (
            <CommentView key={comment.id} comment={comment} store={store} reply={comment.parentId !== null} />
          ))}
        </section>
      ))}
    </div>
  );
}

/**
 * A forge thread, now writable: Reply creates a draft under the thread and the user's own comments
 * get Edit/Delete drafts. Nothing leaves ravi until the explicit Send.
 */
export function RemoteThread({
  thread,
  store,
  className,
}: {
  thread: Thread;
  store: ReviewStore;
  className?: string;
}) {
  const [replying, setReplying] = useState(false);
  const drafts = remoteDraftState(store.document.comments, thread);
  const { threadedPrComments } = useComposerCapabilities();

  const remove = (draft: ReviewComment) => {
    const undo = store.remove(draft.id);
    showToast({ message: 'Pending change removed', action: { label: 'Undo', onClick: undo } }, 6000);
  };

  const removeRemote = (commentId: string) => {
    store.deleteRemote(thread.id, commentId);
    showToast({ message: 'Deletion pending — it will be sent with your review' }, 4000);
  };

  return (
    <article className={[styles.remoteThread, className].filter(Boolean).join(' ')} aria-label="Remote thread">
      <header className={styles.commentHeader}>
        <span className={styles.author}>{thread.comments[0]?.author ?? 'Forge'}</span>
        {thread.comments[0] !== undefined && (
          <time className={styles.time} dateTime={thread.comments[0].createdAt}>
            {relativeTime(thread.comments[0].createdAt)}
          </time>
        )}
        {thread.outdated && <span className={styles.badge}>Outdated</span>}
        {thread.resolved && <span className={styles.badge}>Resolved</span>}
      </header>

      {thread.comments.map((comment) => {
        const edit = drafts.edits.get(comment.id);
        const deletion = drafts.deletes.get(comment.id);
        return (
          <div key={comment.id} className={styles.remoteComment}>
            <header className={styles.commentHeader}>
              <span className={styles.author}>{comment.author}</span>
              <time className={styles.time} dateTime={comment.createdAt}>
                {relativeTime(comment.createdAt)}
              </time>
              {thread.path !== null && <LineLink path={thread.path} side={thread.side} line={thread.line} />}
            </header>
            {deletion === undefined ? (
              <MarkdownView body={comment.body} />
            ) : (
              <p className={styles.deletedBody}>
                <s>{comment.body}</s>
              </p>
            )}
            {deletion !== undefined && (
              <PendingDraft
                label="Deletion pending — it will be sent with your review"
                body={null}
                draftId={deletion.id}
                error={deletion.sendError ?? null}
                onRemove={() => remove(deletion)}
              />
            )}
            {edit !== undefined && (
              <PendingDraft
                label="Edit pending — it will be sent with your review"
                body={edit.body}
                draftId={edit.id}
                error={edit.sendError ?? null}
                onRemove={() => remove(edit)}
                onEdit={(body) => store.edit(edit.id, body)}
              />
            )}
            {comment.canEdit && deletion === undefined && (
              <div className={styles.commentActions}>
                {edit === undefined && (
                  <button
                    type="button"
                    className={styles.action}
                    onClick={() => store.editRemote(thread.id, comment.id, comment.body)}
                  >
                    Edit
                  </button>
                )}
                <button type="button" className={styles.action} onClick={() => removeRemote(comment.id)}>
                  Delete
                </button>
              </div>
            )}
          </div>
        );
      })}

      {drafts.replies.map((draft) => (
        <div key={draft.id} className={styles.remoteComment}>
          <PendingDraft
            label="Reply pending — it will be sent with your review"
            body={draft.body}
            draftId={draft.id}
            error={draft.sendError ?? null}
            onRemove={() => remove(draft)}
            onEdit={(body) => store.edit(draft.id, body)}
          />
        </div>
      ))}

      {(thread.path !== null || threadedPrComments) && (
        <>
          {replying ? (
            <Composer
              submitLabel="Reply"
              onSubmit={(body) => {
                store.replyToRemote(thread.id, body);
                setReplying(false);
              }}
              onCancel={() => setReplying(false)}
            />
          ) : (
            <div className={styles.commentActions}>
              <button type="button" className={styles.action} onClick={() => setReplying((value) => !value)}>
                Reply
              </button>
            </div>
          )}
        </>
      )}
    </article>
  );
}

/** A pending change with the same lifecycle as a local draft: edit, remove, retry on failure. */
function PendingDraft({
  label,
  body,
  draftId,
  error,
  onRemove,
  onEdit,
}: {
  label: string;
  body: string | null;
  draftId: string;
  error: string | null;
  onRemove: () => void;
  onEdit?: (body: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const actions = useSendActions();

  return (
    <div className={styles.pending}>
      <span className={styles.pendingLabel}>{label}</span>
      {body !== null && !editing && (
        <div className={styles.pendingBody}>
          <MarkdownView body={body} />
        </div>
      )}
      {editing && onEdit !== undefined && (
        <Composer
          initialBody={body ?? ''}
          submitLabel="Save change"
          onSubmit={(next) => {
            onEdit(next);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      )}
      {error !== null && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <div className={styles.commentActions}>
        {onEdit !== undefined && body !== null && !editing && (
          <button type="button" className={styles.action} onClick={() => setEditing(true)}>
            Edit
          </button>
        )}
        {error !== null && actions !== null && (
          <button type="button" className={styles.action} onClick={() => actions.retry(draftId)}>
            Retry
          </button>
        )}
        <button type="button" className={styles.action} onClick={onRemove}>
          Undo
        </button>
      </div>
    </div>
  );
}

function CommentView({ comment, store, reply }: { comment: ReviewComment; store: ReviewStore; reply: boolean }) {
  const [editing, setEditing] = useState(false);
  const [replying, setReplying] = useState(false);
  const actions = useSendActions();

  const remove = () => {
    const undo = store.remove(comment.id);
    showToast({ message: 'Comment deleted', action: { label: 'Undo', onClick: undo } }, 6000);
  };

  return (
    <article className={reply ? `${styles.comment} ${styles.reply}` : styles.comment}>
      <header className={styles.commentHeader}>
        <span className={styles.author}>{comment.author ?? 'You'}</span>
        <time className={styles.time} dateTime={comment.createdAt}>
          {relativeTime(comment.createdAt)}
        </time>
        {comment.state === 'draft' && (
          <span className={styles.badge} title="Pending — will be sent with your review">
            Pending
          </span>
        )}
        {comment.outdated && <span className={styles.badge}>Outdated</span>}
        {comment.path !== null && <LineLink path={comment.path} side={comment.side} line={comment.line} />}
        {comment.pendingAction === 'delete' && <span className={styles.badge}>Will be deleted</span>}
        {comment.pendingAction === 'edit' && <span className={styles.badge}>Will be edited</span>}
      </header>
      {editing ? (
        <Composer
          initialBody={comment.body}
          submitLabel="Save"
          onSubmit={(body) => {
            store.edit(comment.id, body);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <MarkdownView body={comment.body} />
      )}
      {(comment.sendError ?? null) !== null && (
        <p className={styles.error} role="alert">
          {comment.sendError}
          {actions !== null && (
            <button type="button" className={styles.action} onClick={() => actions.retry(comment.id)}>
              Retry
            </button>
          )}
        </p>
      )}
      {!editing && (
        <div className={styles.commentActions}>
          <button type="button" className={styles.action} onClick={() => setEditing(true)}>
            Edit
          </button>
          <button type="button" className={styles.action} onClick={remove}>
            Delete
          </button>
          <button type="button" className={styles.action} onClick={() => setReplying((value) => !value)}>
            Reply
          </button>
        </div>
      )}
      {replying && !editing && (
        <Composer
          submitLabel="Reply"
          onSubmit={(body) => {
            store.reply(comment.id, body);
            setReplying(false);
          }}
          onCancel={() => setReplying(false)}
        />
      )}
    </article>
  );
}
