/**
 * The result of "find repositories inside a folder": a checkbox per repository found, and one
 * button that connects the ticked ones. Nothing is connected until the user chooses it.
 */
import { useState } from 'react';
import { RepoSchema } from '../../../shared/api.ts';
import type { Repo } from '../../../shared/api.ts';
import { apiSend } from '../../app/api.ts';
import { errorMessage } from '../../app/errors.ts';
import { Button } from '../../components/controls.tsx';
import styles from '../settings/SettingsPage.module.css';
import { pathKey } from './scan.ts';

type Props = {
  /** The folder that was scanned, shown in the heading. */
  folder: string;
  /** Repository folders the scan found. */
  found: readonly string[];
  /** `pathKey`s of repositories that are already connected; they are listed but cannot be ticked. */
  connected: ReadonlySet<string>;
  /** Called with the repositories that were connected. */
  onAdded: (added: Repo[]) => void;
  onCancel: () => void;
};

export function FoundRepos({ folder, found, connected, onAdded, onCancel }: Props) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addable = found.filter((path) => !connected.has(pathKey(path)));
  const toggle = (path: string): void =>
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(path)) {
        next.add(path);
      }
      return next;
    });

  const addSelected = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const added: Repo[] = [];
    try {
      for (const path of addable.filter((candidate) => selected.has(candidate))) {
        added.push(await apiSend('POST', '/api/repos', { path }, RepoSchema));
      }
      onAdded(added);
    } catch (reason) {
      // Whatever was connected before the failure stays connected; the caller reloads its list on close.
      setError(errorMessage(reason, 'Could not add the repositories'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.field} role="group" aria-label="Repositories found">
      <p className={styles.stepTitle}>
        {found.length === 0
          ? `No git repositories found in ${folder}`
          : `${found.length} ${found.length === 1 ? 'repository' : 'repositories'} found in ${folder}`}
      </p>
      {found.length > 0 && (
        <>
          <ul className={styles.repoList}>
            {found.map((path) => {
              const already = connected.has(pathKey(path));
              return (
                <li key={path} className={styles.repoItem}>
                  <label className={styles.radio}>
                    <input
                      type="checkbox"
                      checked={already || selected.has(path)}
                      disabled={already || busy}
                      onChange={() => toggle(path)}
                    />
                    <code className={styles.mono}>{path}</code>
                    {already && <span className={styles.hint}>already added</span>}
                  </label>
                </li>
              );
            })}
          </ul>
          <div className={styles.wizardActions}>
            <Button disabled={busy || addable.length === 0} onClick={() => setSelected(new Set(addable))}>
              Select all
            </Button>
            <Button disabled={busy || selected.size === 0} onClick={() => setSelected(new Set())}>
              Select none
            </Button>
            <span className={styles.spacer} />
            <Button onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={busy || selected.size === 0}
              aria-busy={busy}
              onClick={() => void addSelected()}
            >
              Add selected ({selected.size})
            </Button>
          </div>
        </>
      )}
      {found.length === 0 && (
        <div className={styles.wizardActions}>
          <Button onClick={onCancel}>Close</Button>
        </div>
      )}
      {error !== null && (
        <p className={styles.fieldError} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
