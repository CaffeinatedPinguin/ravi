/** Diff toolbar controls shared by the local review and the pull request review. */
import type { ReactNode } from 'react';
import type { Settings } from '../../../shared/api.ts';
import { IconButton, Segmented, Toggle } from '../../components/controls.tsx';

type DiffControlsProps = {
  ignoreWhitespace: boolean;
  onIgnoreWhitespace: (ignoreWhitespace: boolean) => void;
  viewMode: Settings['viewMode'];
  onViewMode: (viewMode: Settings['viewMode']) => void;
  linkMode: Settings['linkMode'];
  onLinkMode: (linkMode: Settings['linkMode']) => void;
  urlAvailable: boolean;
  /** Why URL mode is unavailable; shown as a tooltip on the disabled segment. */
  urlTitle: string;
  onCollapse: () => void;
  /** Screen-specific toggles, e.g. "Untracked files" on a working-tree comparison. */
  children?: ReactNode;
};

export function DiffControls({
  ignoreWhitespace,
  onIgnoreWhitespace,
  viewMode,
  onViewMode,
  linkMode,
  onLinkMode,
  urlAvailable,
  urlTitle,
  onCollapse,
  children,
}: DiffControlsProps) {
  return (
    <>
      {children}
      <Toggle checked={ignoreWhitespace} onChange={onIgnoreWhitespace}>
        Hide whitespace
      </Toggle>
      <Segmented
        label="Diff layout"
        value={viewMode}
        options={[
          { value: 'unified', label: 'Unified', icon: 'unified' },
          { value: 'split', label: 'Split', icon: 'split' },
        ]}
        onChange={onViewMode}
      />
      <Segmented
        label="Link mode"
        value={linkMode}
        options={[
          { value: 'path', label: 'Path' },
          { value: 'url', label: 'URL', disabled: !urlAvailable, title: urlTitle },
        ]}
        onChange={onLinkMode}
      />
      <IconButton icon="collapse" label="Collapse all files" onClick={onCollapse} />
    </>
  );
}
