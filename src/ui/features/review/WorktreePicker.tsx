/**
 * Switches the review between the connected folder and its linked worktrees. Hidden while the
 * repository has at most one worktree, where the branch badge says everything there is to say.
 */
import type { ReactNode } from 'react';
import { WorktreeListSchema } from '../../../shared/api.ts';
import type { DiffTarget, RepoInfo } from '../../../shared/api.ts';
import { apiGet } from '../../app/api.ts';
import { navigate } from '../../app/router.ts';
import { useSettings } from '../../app/settings.tsx';
import { useAsync } from '../../app/useAsync.ts';
import { Combobox } from '../../components/Combobox.tsx';
import { initialBaseBranch } from '../settings/validation.ts';
import styles from './ReviewPage.module.css';
import { decodeTarget, encodeTarget, targetPath } from './target.ts';

type WorktreePickerProps = {
  repoId: string;
  target: DiffTarget;
  info: RepoInfo | undefined;
  /** What to show instead of the selector when there is nothing to switch between. */
  fallback: ReactNode;
};

export function WorktreePicker({ repoId, target, info, fallback }: WorktreePickerProps) {
  const { settings } = useSettings();
  const worktrees = useAsync(`worktrees:${repoId}`, (signal) =>
    apiGet(`/api/repos/${repoId}/worktrees`, WorktreeListSchema, signal),
  );
  const entries = worktrees.data ?? [];
  if (entries.length <= 1) {
    return fallback;
  }

  const current = entries.find((entry) => entry.current)?.path;
  // Selecting the connected folder means "no worktree"; its listed path is only a display value.
  const value = target.worktree ?? current ?? '';
  const branches = info?.branches ?? [];
  const options = entries.map((entry) => ({
    value: entry.path,
    label: entry.current ? `${entry.branch ?? 'detached'} (this folder)` : (entry.branch ?? 'detached'),
    detail: entry.path,
  }));

  const select = (path: string) => {
    const entry = entries.find((candidate) => candidate.path === path);
    if (entry === undefined) {
      return;
    }
    if (entry.current) {
      // Picking the connected folder drops `w` but keeps the comparison the user was looking at.
      navigate(targetPath(repoId, decodeTarget(encodeTarget(target))));
      return;
    }
    const base = initialBaseBranch(settings.defaultBaseBranch, info?.defaultBranch ?? null, branches);
    // A worktree is reviewed for everything it has beyond the default base; without a base branch
    // there is nothing to merge from, so its uncommitted work is the honest fallback.
    const next: DiffTarget =
      base === null ? { kind: 'uncommitted', worktree: entry.path } : { kind: 'all', base, worktree: entry.path };
    navigate(targetPath(repoId, next));
  };

  return (
    <Combobox
      label="Worktree"
      className={styles.worktree}
      value={value}
      options={options}
      onChange={select}
    />
  );
}
