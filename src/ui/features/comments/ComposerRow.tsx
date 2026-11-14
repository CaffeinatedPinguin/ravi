/** The inline composer that opens under a code line. */
import type { ComposerTarget } from '../diff/rows.ts';
import { Composer } from './Composer.tsx';
import styles from './Comments.module.css';
import type { ReviewStore } from './reviewStore.ts';

type ComposerRowProps = {
  path: string;
  target: ComposerTarget;
  store: ReviewStore;
  onClose: () => void;
};

export function ComposerRow({ path, target, store, onClose }: ComposerRowProps) {
  return (
    <div className={styles.composerRow}>
      <Composer
        submitLabel={target.startLine === null ? 'Add comment' : `Comment on lines ${target.startLine}–${target.line}`}
        onSubmit={(body) => {
          store.add({ path, side: target.side, line: target.line, startLine: target.startLine, body });
          onClose();
        }}
        onCancel={onClose}
      />
    </div>
  );
}
