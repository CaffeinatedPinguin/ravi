/**
 * Notes above the diff: the review summary and the comments that are not attached to a file.
 *
 * It is a panel, not a dialog, so the diff underneath stays readable and scrollable while a
 * review-level conclusion is written.
 */
import { useState } from 'react';
import type { ReviewComment } from '../../../shared/review.ts';
import { Button, IconButton } from '../../components/controls.tsx';
import { Composer } from './Composer.tsx';
import { isRemoteDraft } from './remoteDrafts.ts';
import type { ReviewStore } from './reviewStore.ts';
import styles from './ReviewNotes.module.css';
import { ThreadRow } from './Thread.tsx';
import type { CommentThread } from './threads.ts';

type ReviewNotesProps = { store: ReviewStore; onClose: () => void };

export function ReviewNotes({ store, onClose }: ReviewNotesProps) {
  const [composing, setComposing] = useState(false);
  const document = store.document;
  const general = document.comments.filter((comment) => comment.path === null && !isRemoteDraft(comment));

  return (
    <section id="review-notes" className={styles.panel} aria-labelledby="review-notes-heading">
      <header className={styles.header}>
        <h2 id="review-notes-heading" className={styles.heading}>
          Review notes
        </h2>
        <span className={styles.spacer} />
        <IconButton icon="close" label="Close review notes" onClick={onClose} />
      </header>

      <label className={styles.label} htmlFor="review-summary">
        Summary
      </label>
      <textarea
        id="review-summary"
        className={styles.summary}
        value={document.summary ?? ''}
        placeholder="Summarise the review. Markdown is supported."
        onChange={(event) => store.setSummary(event.target.value)}
      />

      <div className={styles.commentsHeader}>
        <h3 className={styles.heading}>General comments</h3>
        <span className={styles.count}>{general.length}</span>
        <span className={styles.spacer} />
        <Button variant="ghost" aria-expanded={composing} onClick={() => setComposing((value) => !value)}>
          Add note
        </Button>
      </div>
      {composing && (
        <Composer
          submitLabel="Add note"
          onSubmit={(body) => {
            store.addGeneral(body);
            setComposing(false);
          }}
          onCancel={() => setComposing(false)}
        />
      )}
      <ThreadRow threads={generalThreads(general)} store={store} reviewLevel />
    </section>
  );
}

/** Groups path-less comments like the diff groups file comments: roots first, replies below them. */
function generalThreads(comments: readonly ReviewComment[]): CommentThread[] {
  const roots = new Map<string, CommentThread>();
  const threads: CommentThread[] = [];
  const pending: ReviewComment[] = [];

  for (const comment of comments) {
    if (comment.parentId === null) {
      // A synthetic thread key: it never reaches the diff, it only keys this list.
      const thread: CommentThread = {
        key: comment.id,
        path: '',
        side: 'new',
        line: 1,
        startLine: null,
        comments: [comment],
      };
      roots.set(comment.id, thread);
      threads.push(thread);
    } else {
      const parent = roots.get(comment.parentId);
      if (parent) {
        parent.comments.push(comment);
      } else {
        pending.push(comment);
      }
    }
  }

  for (const comment of pending) {
    const parent = comment.parentId === null ? undefined : roots.get(comment.parentId);
    parent?.comments.push(comment);
  }
  return threads;
}
