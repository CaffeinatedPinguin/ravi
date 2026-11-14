/**
 * The two explicit forge-writing controls on a pull request: Approve and Send (N).
 *
 * Nothing here talks to the server; the page owns the send request. The dialog is native `<dialog>`
 * so focus trapping, Esc and the backdrop come from the browser.
 */
import { useEffect, useRef, useState } from 'react';
import type { ReviewAction } from '../../../shared/forge.ts';
import { Button, IconButton } from '../../components/controls.tsx';
import styles from './SendControls.module.css';
import type { SendPlan } from './sendPlan.ts';
import { verdictLabel } from './sendPlan.ts';

type SendControlsProps = {
  count: number;
  /** False when there is neither a draft nor a summary to send. */
  canSend: boolean;
  /** Why Approve is unavailable, or null when it may be pressed. */
  approveDisabledReason: string | null;
  requestChanges: boolean;
  onApprove: () => void;
  onOpen: (action: ReviewAction) => void;
};

export function SendControls({
  count,
  canSend,
  approveDisabledReason,
  requestChanges,
  onApprove,
  onOpen,
}: SendControlsProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  const choose = (action: ReviewAction) => {
    setMenuOpen(false);
    onOpen(action);
  };

  // Ctrl/Cmd+Shift+Enter opens the confirmation; it never sends by itself.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || !event.shiftKey || event.key !== 'Enter') {
        return;
      }
      event.preventDefault();
      if (!canSend) {
        return;
      }
      setMenuOpen(false);
      onOpen('comment');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [canSend, onOpen]);

  return (
    <div className={styles.controls}>
      <Button disabled={approveDisabledReason !== null} title={approveDisabledReason ?? 'Approve this pull request'} onClick={onApprove}>
        Approve
      </Button>
      <div className={styles.split}>
        <Button variant="primary" disabled={!canSend} onClick={() => choose('comment')}>
          Send ({count})
        </Button>
        <IconButton
          icon="chevronDown"
          label="Choose the review verdict"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          disabled={!canSend}
          onClick={() => setMenuOpen((value) => !value)}
        />
        {menuOpen && (
          <div className={styles.menu} role="menu" aria-label="Send with verdict">
            <button type="button" role="menuitem" className={styles.menuItem} onClick={() => choose('comment')}>
              Comment
            </button>
            <button type="button" role="menuitem" className={styles.menuItem} onClick={() => choose('approve')}>
              Approve
            </button>
            {requestChanges && (
              <button
                type="button"
                role="menuitem"
                className={styles.menuItem}
                onClick={() => choose('requestChanges')}
              >
                Request changes
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

type SendDialogProps = {
  open: boolean;
  plan: SendPlan;
  host: string;
  sending: boolean;
  /** Set when the server answered 409; the dialog then offers Reload and Send anyway. */
  conflict: string | null;
  error: string | null;
  onClose: () => void;
  onSummaryChange: (summary: string) => void;
  onConfirm: (force: boolean) => void;
  onReload: () => void;
};

export function SendDialog({
  open,
  plan,
  host,
  sending,
  conflict,
  error,
  onClose,
  onSummaryChange,
  onConfirm,
  onReload,
}: SendDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (element === null) {
      return;
    }
    if (open && !element.open) {
      element.showModal();
    } else if (!open && element.open) {
      element.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby="send-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!sending) {
          onClose();
        }
      }}
    >
      <header className={styles.dialogHeader}>
        <h2 id="send-title">Send review</h2>
        <IconButton icon="close" label="Cancel sending" disabled={sending} onClick={onClose} />
      </header>

      <p className={styles.target}>
        {verdictLabel(plan.action)} — <strong>{plan.target}</strong>
      </p>

      <label className={styles.label} htmlFor="send-summary">
        Summary
      </label>
      <textarea
        id="send-summary"
        className={styles.summary}
        value={plan.summary ?? ''}
        placeholder="Optional note that is sent with the verdict."
        onChange={(event) => onSummaryChange(event.target.value)}
      />

      <p className={styles.counts}>
        {plan.counts.total} draft{plan.counts.total === 1 ? '' : 's'}: {plan.counts.comment} comment
        {plan.counts.comment === 1 ? '' : 's'}, {plan.counts.reply} repl{plan.counts.reply === 1 ? 'y' : 'ies'},{' '}
        {plan.counts.edit} edit{plan.counts.edit === 1 ? '' : 's'}, {plan.counts.delete} deletion
        {plan.counts.delete === 1 ? '' : 's'}
      </p>

      {plan.drafts.length > 0 && (
        <ul className={styles.draftList} aria-label="Drafts that will be sent">
          {plan.drafts.map((draft) => (
            <li key={draft.id} className={styles.draft}>
              <span className={styles.draftKind}>{draft.kind}</span>
              <code className={styles.draftWhere}>{draft.where}</code>
              <span className={styles.draftPreview}>{draft.preview}</span>
            </li>
          ))}
        </ul>
      )}

      {conflict !== null && (
        <div className={styles.conflict} role="alert">
          <p>{conflict}</p>
          <div className={styles.actions}>
            <Button variant="ghost" onClick={onReload} disabled={sending}>
              Reload
            </Button>
            <Button onClick={() => onConfirm(true)} disabled={sending}>
              Send anyway
            </Button>
          </div>
        </div>
      )}
      {error !== null && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <div className={styles.actions}>
        <Button variant="ghost" onClick={onClose} disabled={sending}>
          Cancel
        </Button>
        <Button variant="primary" onClick={() => onConfirm(false)} disabled={sending || conflict !== null}>
          {sending ? 'Sending…' : `Send to ${host}`}
        </Button>
      </div>
    </dialog>
  );
}
