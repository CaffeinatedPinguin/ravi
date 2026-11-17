/** Chooses what to review: uncommitted work, the staging area, a branch against its base, or a commit range. */
import { useMemo, useState } from 'react';
import type { DiffTarget, Refs, RepoInfo } from '../../../shared/api.ts';
import { useSettings } from '../../app/settings.tsx';
import { Combobox } from '../../components/Combobox.tsx';
import type { ComboboxOption } from '../../components/Combobox.tsx';
import { Button } from '../../components/controls.tsx';
import { initialBaseBranch } from '../settings/validation.ts';
import styles from './ReviewPage.module.css';

type TargetPickerProps = {
  target: DiffTarget;
  info: RepoInfo | undefined;
  /** Branches, tags and recent commits; undefined while the request is in flight. */
  refs: Refs | undefined;
  onChange: (target: DiffTarget) => void;
};

const KIND_LABEL: Record<DiffTarget['kind'], string> = {
  uncommitted: 'Uncommitted changes',
  unstaged: 'Unstaged changes',
  staged: 'Staged changes',
  branch: 'Branch against…',
  all: 'All changes against…',
  range: 'Commit range…',
};

export function TargetPicker({ target, info, refs, onChange }: TargetPickerProps) {
  const { settings } = useSettings();
  const [range, setRange] = useState(target.kind === 'range' ? { from: target.from, to: target.to } : { from: '', to: 'HEAD' });
  // Settings wins only for a branch this repository actually has; otherwise today's detection.
  const branches = refs?.branches ?? info?.branches ?? [];
  const defaultBase = initialBaseBranch(settings.defaultBaseBranch, info?.defaultBranch ?? null, branches);
  // The selected worktree survives every comparison change; only the Worktree selector removes it.
  const worktree = target.worktree;
  const keepWorktree = (next: DiffTarget): DiffTarget => (worktree === undefined ? next : { ...next, worktree });

  // The base comparison only makes sense against a branch, so tags and commits stay out of this list.
  const baseOptions = useMemo<ComboboxOption[]>(() => {
    const repoBranches = refs?.branches ?? info?.branches ?? [];
    const options: ComboboxOption[] = [
      ...repoBranches.map((name) => ({ value: name, label: name, group: 'Branches' })),
      ...(refs?.remoteBranches ?? []).map((name) => ({ value: name, label: name, group: 'Remote branches' })),
    ];
    const base = target.kind === 'branch' || target.kind === 'all' ? target.base : null;
    if (base !== null && !options.some((option) => option.value === base)) {
      // A bookmarked base that no longer exists must stay visible until the user picks another one.
      options.unshift({ value: base, label: base, group: 'Branches' });
    }
    return options;
  }, [refs, info, target]);

  // The range picker gets everything: a commit id typed by hand is still accepted.
  const rangeOptions = useMemo<ComboboxOption[]>(() => {
    const repoBranches = refs?.branches ?? info?.branches ?? [];
    return [
      ...repoBranches.map((name) => ({ value: name, label: name, group: 'Branches' })),
      ...(refs?.remoteBranches ?? []).map((name) => ({ value: name, label: name, group: 'Remote branches' })),
      ...(refs?.tags ?? []).map((name) => ({ value: name, label: name, group: 'Tags' })),
      ...(refs?.commits ?? []).map((commit) => ({
        value: commit.sha,
        label: commit.shortSha,
        detail: commit.subject,
        group: 'Commits',
      })),
    ];
  }, [refs, info]);

  const selectKind = (kind: DiffTarget['kind']) => {
    if (kind === 'branch' || kind === 'all') {
      // While `info` is still loading, fall back to a branch that exists in the loaded refs list;
      // a repository with no branch at all cannot compare against a base, so keep the target.
      const base = defaultBase ?? info?.branch ?? branches[0] ?? null;
      if (base !== null) {
        onChange(keepWorktree(kind === 'branch' ? { kind: 'branch', base } : { kind: 'all', base }));
      }
    } else if (kind === 'range') {
      onChange(keepWorktree({ kind, from: range.from || 'HEAD~1', to: range.to || 'HEAD', mergeBase: false }));
    } else {
      onChange(keepWorktree({ kind }));
    }
  };

  return (
    <div className={styles.target}>
      <select aria-label="What to review" value={target.kind} onChange={(event) => selectKind(event.target.value as DiffTarget['kind'])}>
        {Object.entries(KIND_LABEL).map(([kind, label]) => (
          <option key={kind} value={kind}>
            {label}
          </option>
        ))}
      </select>
      {(target.kind === 'branch' || target.kind === 'all') && (
        <Combobox
          label="Base branch"
          value={target.base}
          options={baseOptions}
          onChange={(base) => onChange(keepWorktree(target.kind === 'branch' ? { kind: 'branch', base } : { kind: 'all', base }))}
        />
      )}
      {target.kind === 'range' && (
        <form
          className={styles.range}
          onSubmit={(event) => {
            event.preventDefault();
            if (range.from.trim() !== '' && range.to.trim() !== '') {
              onChange(keepWorktree({ kind: 'range', from: range.from.trim(), to: range.to.trim(), mergeBase: false }));
            }
          }}
        >
          <Combobox
            label="From commit or ref"
            placeholder="from"
            value={range.from}
            options={rangeOptions}
            allowCustom
            onChange={(from) => setRange({ ...range, from })}
          />
          <span aria-hidden="true">..</span>
          <Combobox
            label="To commit or ref"
            placeholder="to"
            value={range.to}
            options={rangeOptions}
            allowCustom
            onChange={(to) => setRange({ ...range, to })}
          />
          <Button type="submit">Show</Button>
        </form>
      )}
    </div>
  );
}
