/** First run: nothing is connected yet, so the only useful next step is Settings → Repositories. */
import { navigate } from '../../app/router.ts';
import { Brand } from '../../components/Brand.tsx';
import { Button } from '../../components/controls.tsx';
import { TopBarActions } from '../../components/TopBarActions.tsx';
import styles from './DashboardPage.module.css';

export function SetupScreen({ notice }: { notice: string | null }) {
  return (
    <div className={styles.page}>
      <header className={styles.topBar}>
        <Brand />
        <span className={styles.spacer} />
        <TopBarActions />
      </header>

      <main className={styles.setupBody}>
        <div className={styles.setupHero}>
          <h1 className={styles.setupTitle}>Review local changes and pull requests in one calm place.</h1>
          <p className={styles.setupLead}>
            ravi reads your git folders and GitHub/GitLab pull requests, keeps review comments as drafts, and
            sends them to the forge only when you ask. Everything stays on this machine.
          </p>
          {notice !== null && (
            <p className={styles.error} role="alert">
              {notice}
            </p>
          )}
          <div className={styles.setupActions}>
            <Button variant="primary" onClick={() => navigate('/settings#repositories')}>
              Add your first repository
            </Button>
            <Button onClick={() => navigate('/settings#accounts')}>How tokens work</Button>
          </div>
          <p className={styles.setupHint}>
            Tokens are stored in the <code>.env</code> file in the ravi data folder (only readable by you). Set them in Settings → Accounts or
            per repository; ravi never shows them again.
          </p>
        </div>
      </main>
    </div>
  );
}
