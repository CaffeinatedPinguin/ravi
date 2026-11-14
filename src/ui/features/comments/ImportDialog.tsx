/**
 * Import a review Markdown file, pasted text or a dropped file.
 *
 * The dialog only previews: the import route merges into the current document and returns a report,
 * and the document is applied solely when the user presses Apply. The native `<dialog>` keeps the
 * browser's focus trap and Esc handling.
 */
import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import type { DiffTarget, ReviewReport } from '../../../shared/api.ts';
import { ReviewImportResponseSchema } from '../../../shared/api.ts';
import type { ReviewDocument } from '../../../shared/review.ts';
import { apiSend } from '../../app/api.ts';
import { Button, IconButton } from '../../components/controls.tsx';
import { readImportFile } from './importFile.ts';
import styles from './ImportDialog.module.css';

type ImportDialogProps = {
  repoId: string;
  diffTarget: DiffTarget;
  currentDocument: ReviewDocument;
  /** Text already read from a file dropped on the review page. */
  initialMarkdown: string;
  onClose: () => void;
  onApply: (document: ReviewDocument) => void;
};

type Preview = { document: ReviewDocument; report: ReviewReport };

export function ImportDialog({ repoId, diffTarget, currentDocument, initialMarkdown, onClose, onApply }: ImportDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [markdown, setMarkdown] = useState(initialMarkdown);
  const [fileName, setFileName] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) {
      element.showModal();
    }
  }, []);

  const loadFile = async (file: File) => {
    setError(null);
    setReading(true);
    try {
      const text = await readImportFile(file);
      setMarkdown(text);
      setFileName(file.name);
      setPreview(null);
    } catch (reason) {
      setError(message(reason));
    } finally {
      setReading(false);
    }
  };

  const chooseFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Reset, so choosing the same file again still fires a change.
    event.target.value = '';
    if (file) {
      void loadFile(file);
    }
  };

  const runPreview = async () => {
    setError(null);
    setBusy(true);
    try {
      setPreview(
        await apiSend(
          'POST',
          '/api/reviews/import',
          { repoId, diffTarget, document: currentDocument, markdown },
          ReviewImportResponseSchema,
        ),
      );
    } catch (reason) {
      setPreview(null);
      setError(message(reason));
    } finally {
      setBusy(false);
    }
  };

  const changeMarkdown = (value: string) => {
    setMarkdown(value);
    setPreview(null);
  };

  return (
    <dialog ref={dialog} className={styles.dialog} aria-labelledby="import-heading" onClose={onClose}>
      <header className={styles.header}>
        <h2 id="import-heading" className={styles.heading}>
          Import review
        </h2>
        <span className={styles.spacer} />
        <IconButton icon="close" label="Close import dialog" onClick={onClose} />
      </header>

      <p className={styles.hint}>Choose a file or paste a review export. Nothing changes until you press Apply.</p>

      <label className={styles.label}>
        Choose a file (.md or .txt, up to 2 MiB)
        <input className={styles.input} type="file" accept=".md,.txt,text/markdown,text/plain" onChange={chooseFile} disabled={reading} />
      </label>
      {fileName !== null && (
        <p className={styles.hint} role="status">
          Loaded {fileName}.
        </p>
      )}

      <label className={styles.label}>
        Or paste the Markdown
        <textarea
          className={styles.textarea}
          value={markdown}
          aria-label="Review Markdown to import"
          placeholder="Paste a review export here…"
          onChange={(event) => changeMarkdown(event.target.value)}
        />
      </label>

      {error !== null && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {preview !== null && <ImportReport preview={preview} />}

      <footer className={styles.footer}>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <span className={styles.spacer} />
        <Button onClick={() => void runPreview()} disabled={busy || reading || markdown.trim() === ''}>
          {busy ? 'Previewing…' : 'Preview'}
        </Button>
        <Button variant="primary" onClick={() => preview && onApply(preview.document)} disabled={preview === null || busy}>
          Apply
        </Button>
      </footer>
    </dialog>
  );
}

function ImportReport({ preview }: { preview: Preview }) {
  const { added, edited, skipped, errors } = preview.report;
  return (
    <div className={styles.report} role="status">
      <p className={styles.counts}>
        {added} added · {edited} edited · {skipped} skipped
      </p>
      {errors.length > 0 && (
        <ul className={styles.errors} aria-label="Import errors">
          {errors.map((entry, index) => (
            <li key={`${entry.line}-${index}`}>
              Line {entry.line}: {entry.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'Could not import the review';
}
