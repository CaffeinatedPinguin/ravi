/** Inline threads under a commented line: root comment, replies and their actions. */
import { useState } from 'react';
import type { ReviewComment } from '../../../shared/review.ts';
import { showToast } from '../../components/Toast.tsx';
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
          key={thread.key}
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
          {thread.comments.map((comment) => (
            <CommentView key={comment.id} comment={comment} store={store} reply={comment.parentId !== null} />
          ))}
        </section>
      ))}
    </div>
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
