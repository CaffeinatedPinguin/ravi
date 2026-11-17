/** Forge accounts: which host has a token and the exact line to add when it does not. */
import { useState } from 'react';
import { apiGet, apiSend } from '../../app/api.ts';
import { useAsync } from '../../app/useAsync.ts';
import { Button } from '../../components/controls.tsx';
import { ForgeStatusListSchema } from '../pulls/schemas.ts';
import styles from './HomePage.module.css';

export function AccountsSection() {
  const forges = useAsync('forges', (signal) => apiGet('/api/forges', ForgeStatusListSchema, signal));
  const [reloading, setReloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    setReloading(true);
    setError(null);
    try {
      await apiSend('POST', '/api/forges/reload', {}, ForgeStatusListSchema);
      forges.reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not reload the tokens');
    } finally {
      setReloading(false);
    }
  };

  return (
    <section aria-labelledby="accounts-heading">
      <div className={styles.sectionHeader}>
        <h2 id="accounts-heading">Accounts</h2>
        <span className={styles.spacer} />
        <Button icon="refresh" disabled={reloading} aria-busy={reloading} onClick={() => void reload()}>
          {reloading ? 'Reloading…' : 'Reload .env'}
        </Button>
      </div>
      {(error ?? forges.error) !== null && (
        <p className={styles.error} role="alert">
          {error ?? forges.error}
        </p>
      )}
      {forges.data?.length === 0 && <p className={styles.empty}>No forge hosts are configured.</p>}
      <ul className={styles.list}>
        {forges.data?.map((forge) => {
          const token = `${forge.kind.toUpperCase()}_TOKEN`;
          return (
            <li key={forge.host} className={styles.item}>
              <span className={styles.repoLink}>
                <strong>{forge.host}</strong>
                <span className={styles.path}>{forge.kind}</span>
              </span>
              {forge.hasToken ? (
                <span className={styles.badge} data-kind="closed">
                  Token present
                </span>
              ) : (
                <code className={styles.instruction}>add {token}=… to the .env file in the ravi data folder</code>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
