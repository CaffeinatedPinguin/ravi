/**
 * `?` opens the shortcuts that are active on the page that mounted this dialog. Pages own the
 * list, so a tab that cannot use `c` or the send chord does not advertise it.
 *
 * The dialog is native `<dialog>`: Esc, focus trapping and the backdrop come from the browser.
 */
import { useEffect, useRef, useState } from 'react';
import { IconButton } from './controls.tsx';
import styles from './ShortcutsDialog.module.css';

export type Shortcut = { keys: string; description: string };

export function ShortcutsDialog({ shortcuts }: { shortcuts: readonly Shortcut[] }) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== '?' || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      const target = event.target;
      if (target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable]')) {
        return;
      }
      event.preventDefault();
      setOpen(true);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

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
      aria-labelledby="shortcuts-title"
      onCancel={(event) => {
        event.preventDefault();
        setOpen(false);
      }}
    >
      <header className={styles.header}>
        <h2 id="shortcuts-title">Keyboard shortcuts</h2>
        <IconButton icon="close" label="Close shortcuts" onClick={() => setOpen(false)} />
      </header>
      <table className={styles.table}>
        <tbody>
          {shortcuts.map((shortcut) => (
            <tr key={shortcut.keys}>
              <th scope="row">
                <kbd className={styles.keys}>{shortcut.keys}</kbd>
              </th>
              <td>{shortcut.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </dialog>
  );
}
