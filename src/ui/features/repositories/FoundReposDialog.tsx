/**
 * The folder passed to `ravi <folder>` is not a repository itself, but repositories live inside it.
 *
 * The dialog offers the same choice as the "find repositories" step: nothing is connected until the
 * user ticks it. It only mounts after a successful scan, so the old error is no longer useful; the
 * native `<dialog>` supplies Esc, the focus trap and the backdrop.
 */
import { useEffect, useRef } from 'react';
import { RepoListSchema } from '../../../shared/api.ts';
import type { Repo } from '../../../shared/api.ts';
import { apiGet } from '../../app/api.ts';
import { useAsync } from '../../app/useAsync.ts';
import { Button } from '../../components/controls.tsx';
import styles from './FoundReposDialog.module.css';
import { FoundRepos } from './FoundRepos.tsx';
import { connectedKeys } from './scan.ts';

type Props = {
  folder: string;
  found: readonly string[];
  onAdded: (added: Repo[]) => void;
  onCancel: () => void;
};

export function FoundReposDialog({ folder, found, onAdded, onCancel }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const repos = useAsync('repos', (signal) => apiGet('/api/repos', RepoListSchema, signal));

  useEffect(() => {
    const element = dialog.current;
    if (element !== null && !element.open) {
      element.showModal();
    }
  }, []);

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby="found-repos-title"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <header className={styles.header}>
        <h2 id="found-repos-title">No repository here</h2>
      </header>
      <p className={styles.hint}>
        ravi found {found.length} {found.length === 1 ? 'repository' : 'repositories'} in {folder}. Choose which ones
        to add.
      </p>

      {repos.error !== null && (
        <p className={styles.error} role="alert">
          {repos.error} <Button onClick={repos.reload}>Try again</Button>
        </p>
      )}
      {repos.error === null && repos.data === undefined && (
        <p className={styles.hint}>Checking the connected repositories…</p>
      )}
      {repos.error === null && repos.data !== undefined && (
        <FoundRepos
          folder={folder}
          found={found}
          connected={connectedKeys(repos.data.map((repo) => repo.path))}
          onAdded={onAdded}
          onCancel={onCancel}
        />
      )}
    </dialog>
  );
}
