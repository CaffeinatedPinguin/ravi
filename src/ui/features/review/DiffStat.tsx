/** Size of the diff, as on GitHub: added and deleted lines, file count and five proportional squares. */
import styles from './ReviewPage.module.css';

const SQUARES = 5;

export function DiffStat({ additions, deletions, files }: { additions: number; deletions: number; files: number }) {
  const total = additions + deletions;
  const added = total === 0 ? 0 : Math.round((additions / total) * SQUARES);
  // A non-empty side always gets at least one square, otherwise small deletions would vanish.
  const addSquares = total === 0 ? 0 : Math.min(Math.max(added, additions > 0 ? 1 : 0), deletions > 0 ? SQUARES - 1 : SQUARES);
  const delSquares = total === 0 ? 0 : SQUARES - addSquares;
  return (
    <div className={styles.stat} aria-label={`${additions} additions, ${deletions} deletions in ${files} files`}>
      <span className={styles.statAdd}>+{additions.toLocaleString()}</span>
      <span className={styles.statDel}>−{deletions.toLocaleString()}</span>
      <span className={styles.squares} aria-hidden="true">
        {Array.from({ length: SQUARES }, (_, index) => (
          <span key={index} data-kind={index < addSquares ? 'add' : index < addSquares + delSquares ? 'del' : 'none'} />
        ))}
      </span>
      <span className={styles.statFiles}>
        {files.toLocaleString()} {files === 1 ? 'file' : 'files'}
      </span>
    </div>
  );
}
