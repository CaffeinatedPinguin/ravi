/** Inline threads under a commented line: local drafts, forge threads and their actions. */
import { useState } from 'react';
import type { Thread } from '../../../shared/forge.ts';
import type { ReviewComment } from '../../../shared/review.ts';
import { showToast } from '../../components/Toast.tsx';
import { LineLink } from '../pulls/LinkMode.tsx';
import { Composer } from './Composer.tsx';
import styles from './Comments.module.css';
import { MarkdownView } from './MarkdownView.tsx';
import type { ReviewStore } from './reviewStore.ts';
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
          {thread.remote !== undefined && <RemoteThread thread={thread.remote} />}
          {thread.comments.map((comment) => (
            <CommentView key={comment.id} comment={comment} store={store} reply={comment.parentId !== null} />
          ))}
        </section>
      ))}
    </div>
  );
}

/** A forge thread is read-only: no edit, delete or reply controls (writing is a later task). */
export function RemoteThread({ thread, className }: { thread: Thread; className?: string }) {
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
      {thread.comments.map((comment) => (
        <div key={comment.id} className={styles.remoteComment}>
          <header className={styles.commentHeader}>
            <span className={styles.author}>{comment.author}</span>
            <time className={styles.time} dateTime={comment.createdAt}>
              {relativeTime(comment.createdAt)}
            </time>
            {thread.path !== null && <LineLink path={thread.path} side={thread.side} line={thread.line} />}
          </header>
          <MarkdownView body={comment.body} />
        </div>
      ))}
    </article>
  );
}

function CommentView({ comment, store, reply }: { comment: ReviewComment; store: ReviewStore; reply: boolean }) {
  const [editing, setEditing] = useState(false);
  const [replying, setReplying] = useState(false);

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
        {comment.state === 'draft' && <span className={styles.badge}>Draft</span>}
        {comment.outdated && <span className={styles.badge}>Outdated</span>}
        {comment.path !== null && <LineLink path={comment.path} side={comment.side} line={comment.line} />}
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
