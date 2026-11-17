/** Repositories: everything per repository (connections, tokens, adding folders), apart from the global Settings. */
import { Brand } from '../../components/Brand.tsx';
import { TopBarActions } from '../../components/TopBarActions.tsx';
import styles from '../settings/SettingsPage.module.css';
import { RepositoriesSection } from './RepositoriesSection.tsx';

export function RepositoriesPage() {
  return (
    <div className={styles.page}>
      <header className={styles.topBar}>
        <Brand />
        <span className={styles.spacer} />
        <TopBarActions />
      </header>

      <main className={styles.body}>
        <h1 className={styles.heading}>Repositories</h1>
        <p className={styles.lead}>
          The local folders and remote repositories ravi knows about, and how each one connects. Settings that apply
          everywhere are in Settings.
        </p>
        <RepositoriesSection />
      </main>
    </div>
  );
}
