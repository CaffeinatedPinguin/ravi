/** Chooses what to review: uncommitted work, the staging area, a branch against its base, or a commit range. */
import { useState } from 'react';
import type { DiffTarget, RepoInfo } from '../../../shared/api.ts';
import { Button } from '../../components/controls.tsx';
import styles from './ReviewPage.module.css';

type TargetPickerProps = {
  target: DiffTarget;
  info: RepoInfo | undefined;
  onChange: (target: DiffTarget) => void;
};

const KIND_LABEL: Record<DiffTarget['kind'], string> = {
  uncommitted: 'Uncommitted changes',
  unstaged: 'Unstaged changes',
  staged: 'Staged changes',
  branch: 'Branch against…',
  range: 'Commit range…',
};

export function TargetPicker({ target, info, onChange }: TargetPickerProps) {
  const [range, setRange] = useState(target.kind === 'range' ? { from: target.from, to: target.to } : { from: '', to: 'HEAD' });
  const branches = info?.branches ?? [];
  const defaultBase = info?.defaultBranch ?? branches[0] ?? 'main';

  const selectKind = (kind: DiffTarget['kind']) => {
    if (kind === 'branch') {
      onChange({ kind, base: defaultBase });
    } else if (kind === 'range') {
      onChange({ kind, from: range.from || 'HEAD~1', to: range.to || 'HEAD', mergeBase: false });
    } else {
      onChange({ kind });
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
      {target.kind === 'branch' && (
        <select aria-label="Base branch" value={target.base} onChange={(event) => onChange({ kind: 'branch', base: event.target.value })}>
          {[...new Set([target.base, ...branches])].map((branch) => (
            <option key={branch} value={branch}>
              {branch}
            </option>
          ))}
        </select>
      )}
      {target.kind === 'range' && (
        <form
          className={styles.range}
          onSubmit={(event) => {
            event.preventDefault();
            if (range.from.trim() !== '' && range.to.trim() !== '') {
              onChange({ kind: 'range', from: range.from.trim(), to: range.to.trim(), mergeBase: false });
            }
          }}
        >
          <input aria-label="From commit or ref" placeholder="from" value={range.from} onChange={(event) => setRange({ ...range, from: event.target.value })} />
          <span aria-hidden="true">..</span>
          <input aria-label="To commit or ref" placeholder="to" value={range.to} onChange={(event) => setRange({ ...range, to: event.target.value })} />
          <Button type="submit">Show</Button>
        </form>
      )}
    </div>
  );
}
