/** Settings → Accounts: one token per forge host, stored by revu in `~/.revu/.env` and shown masked. */
import { useState } from 'react';
import { ForgeStatusViewListSchema, ForgeStatusViewSchema } from '../../../shared/api.ts';
import { apiGet, apiSend } from '../../app/api.ts';
import { useAsync } from '../../app/useAsync.ts';
import { Button } from '../../components/controls.tsx';
import { Section } from './Section.tsx';
import styles from './SettingsPage.module.css';

export function AccountsSettingsSection() {
  const forges = useAsync('forge-accounts', (signal) => apiGet('/api/forges', ForgeStatusViewListSchema, signal));
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const write = async (host: string, token: string | null) => {
    setBusy(host);
    setError(null);
    setNotice(null);
    try {
      const status = await apiSend('PUT', `/api/forges/${host}/token`, { token }, ForgeStatusViewSchema);
      setDrafts((previous) => ({ ...previous, [host]: '' }));
      setNotice(status.hasToken ? `${host} token saved` : `${host} token removed`);
      forges.reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save the token');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Section title="Accounts">
      <p className={styles.hint}>
        Tokens are written to <code>~/.revu/.env</code> with mode 0600 and never shown again — only the last four
        characters.
      </p>
      {(error ?? forges.error) !== null && (
        <p className={styles.fieldError} role="alert">
          {error ?? forges.error}
        </p>
      )}
      {notice !== null && (
        <p className={styles.hint} role="status">
          {notice}
        </p>
      )}
      <ul className={styles.accountList}>
        {forges.data?.map((forge) => (
          <li key={forge.host} className={styles.accountItem}>
            <div className={styles.accountName}>
              <strong>{forge.host}</strong>
              <span className={styles.meta}>
                {forge.kind === 'github'
                  ? 'GitHub token scopes: Pull requests (read/write) + Contents (read)'
                  : 'GitLab token scope: api'}
              </span>
            </div>
            <span className={forge.hasToken ? styles.badgeOn : styles.badgeOff}>
              {forge.hasToken ? `Token saved ${forge.tokenHint ?? ''}` : 'No token'}
            </span>
            <input
              className={styles.textInput}
              type="password"
              aria-label={`Token for ${forge.host}`}
              autoComplete="off"
              placeholder={forge.hasToken ? 'Replace token' : 'Paste token'}
              value={drafts[forge.host] ?? ''}
              onChange={(event) => setDrafts((previous) => ({ ...previous, [forge.host]: event.target.value }))}
            />
            <Button
              aria-label={`Save token for ${forge.host}`}
              disabled={busy !== null || (drafts[forge.host] ?? '').trim() === ''}
              onClick={() => void write(forge.host, (drafts[forge.host] ?? '').trim())}
            >
              Save
            </Button>
            {forge.hasToken && (
              <Button
                aria-label={`Remove token for ${forge.host}`}
                disabled={busy !== null}
                onClick={() => void write(forge.host, null)}
              >
                Remove
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}
