/** The two views of a repository; the local-changes tab exists only for a local folder. */
import { navigate } from '../../app/router.ts';
import styles from './RepoNav.module.css';

type RepoNavProps = {
  repoId: string;
  active: 'local' | 'pulls';
  /** Remote clones have no working tree, so "Local changes" would be meaningless there. */
  showLocal: boolean;
};

export function RepoNav({ repoId, active, showLocal }: RepoNavProps) {
  return (
    <nav className={styles.nav} aria-label="Repository view">
      {showLocal && (
        <a
          className={styles.tab}
          href={`/repo/${repoId}`}
          aria-current={active === 'local' ? 'page' : undefined}
          onClick={(event) => {
            event.preventDefault();
            navigate(`/repo/${repoId}`);
          }}
        >
          Local changes
        </a>
      )}
      <a
        className={styles.tab}
        href={`/repo/${repoId}/pulls`}
        aria-current={active === 'pulls' ? 'page' : undefined}
        onClick={(event) => {
          event.preventDefault();
          navigate(`/repo/${repoId}/pulls`);
        }}
      >
        Pull requests
      </a>
    </nav>
  );
}
