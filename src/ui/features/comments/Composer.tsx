/** The comment editor: Markdown with a preview tab, keyboard submit and image attachments. */
import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, ClipboardEvent, DragEvent, KeyboardEvent } from 'react';
import { Button } from '../../components/controls.tsx';
import { uploadImage } from './assets.ts';
import styles from './Comments.module.css';
import { MarkdownView } from './MarkdownView.tsx';

type ComposerProps = {
  initialBody?: string;
  submitLabel: string;
  onSubmit: (body: string) => void;
  onCancel: () => void;
  autoFocus?: boolean;
};

type Tab = 'write' | 'preview';

export function Composer({ initialBody = '', submitLabel, onSubmit, onCancel, autoFocus = true }: ComposerProps) {
  const [body, setBody] = useState(initialBody);
  const [tab, setTab] = useState<Tab>('write');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus) {
      textarea.current?.focus();
    }
  }, [autoFocus]);

  const insertAtCursor = (snippet: string) => {
    setTab('write');
    const element = textarea.current;
    if (!element) {
      setBody((value) => `${value}\n${snippet}`);
      return;
    }
    const start = element.selectionStart;
    const end = element.selectionEnd;
    setBody((value) => value.slice(0, start) + snippet + value.slice(end));
    requestAnimationFrame(() => {
      element.focus();
      const caret = start + snippet.length;
      element.setSelectionRange(caret, caret);
    });
  };

  const attach = async (file: File) => {
    setError(null);
    setUploading(true);
    try {
      const id = await uploadImage(file);
      insertAtCursor(`![${file.name}](asset:${id})`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not upload the image');
    } finally {
      setUploading(false);
    }
  };

  const submit = () => {
    const text = body.trim();
    if (text !== '') {
      onSubmit(text);
    }
  };

  const cancel = () => {
    // Keep a stray Esc from throwing away a long comment.
    if (body !== initialBody && body.trim() !== '' && !window.confirm('Discard this comment?')) {
      return;
    }
    onCancel();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      submit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const file = imageFromClipboard(event.clipboardData);
    if (file) {
      event.preventDefault();
      void attach(file);
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file) {
      void attach(file);
    }
  };

  return (
    <div className={styles.composer} onDrop={onDrop} onDragOver={(event) => event.preventDefault()}>
      <div className={styles.tabs} role="tablist" aria-label="Comment editor">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'write'}
          className={styles.tab}
          onClick={() => setTab('write')}
        >
          Write
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'preview'}
          className={styles.tab}
          onClick={() => setTab('preview')}
        >
          Preview
        </button>
      </div>
      {tab === 'write' ? (
        <textarea
          ref={textarea}
          className={styles.textarea}
          value={body}
          aria-label="Comment text"
          placeholder="Leave a comment. Markdown is supported; paste or drop an image to attach it."
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setBody(event.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
        />
      ) : (
        <div className={styles.preview}>
          {body.trim() === '' ? <p className={styles.hint}>Nothing to preview.</p> : <MarkdownView body={body} />}
        </div>
      )}
      <div className={styles.composerActions}>
        {uploading && (
          <span className={styles.hint} role="status">
            Uploading image…
          </span>
        )}
        {error !== null && (
          <span className={styles.error} role="alert">
            {error}
          </span>
        )}
        <span className={styles.spacer} />
        <Button variant="ghost" onClick={cancel}>
          Cancel
        </Button>
        <Button variant="primary" onClick={submit} disabled={body.trim() === '' || uploading}>
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}

function imageFromClipboard(data: DataTransfer): File | null {
  for (const item of data.items) {
    if (item.kind === 'file') {
      const file = item.getAsFile();
      if (file && file.type.startsWith('image/')) {
        return file;
      }
    }
  }
  return null;
}
