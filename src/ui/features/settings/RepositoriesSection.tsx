/**
 * Settings → Repositories: the list of connected folders and remotes plus the three-step
 * "Add repository" flow. Connection is a required step because git has to know whether it may use
 * the user's SSH keys or a token; the server stores the token and only ever answers a hint.
 */
import { useRef, useState } from 'react';
import { z } from 'zod';
import {
  PickFolderResponseSchema,
  RepoViewListSchema,
  RepoViewSchema,
  TestConnectionResponseSchema,
} from '../../../shared/api.ts';
import type { RepoTransport, RepoView, TestConnectionResponse } from '../../../shared/api.ts';
import { apiGet, apiSend } from '../../app/api.ts';
import { useAsync } from '../../app/useAsync.ts';
import { Button, IconButton } from '../../components/controls.tsx';
import { Section } from './Section.tsx';
import styles from './SettingsPage.module.css';

const messageOf = (reason: unknown): string => (reason instanceof Error ? reason.message : 'Something went wrong');

export function RepositoriesSection() {
  const repos = useAsync('repos', (signal) => apiGet('/api/repos', RepoViewListSchema, signal));
  const [wizardRepo, setWizardRepo] = useState<RepoView | null | undefined>(undefined);
  const [results, setResults] = useState<Record<string, TestConnectionResponse>>({});
  const [testing, setTesting] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<void>) => {
    setError(null);
    try {
      await action();
    } catch (reason) {
      setError(messageOf(reason));
    }
  };

  const test = (repo: RepoView) =>
    run(async () => {
      setTesting(repo.id);
      try {
        const answer = await apiSend('POST', `/api/repos/${repo.id}/test-connection`, {}, TestConnectionResponseSchema);
        setResults((previous) => ({ ...previous, [repo.id]: answer }));
      } finally {
        setTesting(null);
      }
    });

  const remove = (repo: RepoView) =>
    run(async () => {
      setBusy(repo.id);
      try {
        await apiSend('DELETE', `/api/repos/${repo.id}`, undefined, z.undefined());
        repos.reload();
      } finally {
        setBusy(null);
      }
    });

  return (
    <Section
      title="Repositories"
      action={
        <Button variant="primary" icon="plus" onClick={() => setWizardRepo(null)}>
          Add repository
        </Button>
      }
    >
      {(error ?? repos.error) !== null && (
        <p className={styles.fieldError} role="alert">
          {error ?? repos.error}
        </p>
      )}
      {repos.data?.length === 0 && (
        <p className={styles.hint}>Nothing connected yet. Add a local folder or a repository URL.</p>
      )}
      <ul className={styles.repoList}>
        {repos.data?.map((repo) => {
          const answer = results[repo.id];
          return (
            <li key={repo.id} className={styles.repoItem}>
              <div className={styles.repoMain}>
                <strong>{repo.name}</strong>
                <code className={styles.mono}>
                  {repo.kind === 'remote' && repo.remote !== null
                    ? `https://${repo.remote.host}/${repo.remote.project}`
                    : repo.path}
                </code>
                <span className={styles.meta}>
                  {repo.remote === null ? 'No forge remote' : repo.remote?.host} · {transportLabel(repo.transport)} ·{' '}
                  {repo.hasToken ? `token ${repo.tokenHint ?? 'saved'}` : 'no token'}
                </span>
                {answer !== undefined && <ConnectionResult result={answer} />}
              </div>
              <div className={styles.repoActions}>
                <Button
                  aria-label={`Test connection for ${repo.name}`}
                  disabled={testing !== null}
                  aria-busy={testing === repo.id}
                  onClick={() => void test(repo)}
                >
                  {testing === repo.id ? 'Testing…' : 'Test connection'}
                </Button>
                <Button aria-label={`Edit ${repo.name}`} onClick={() => setWizardRepo(repo)}>
                  Edit
                </Button>
                <IconButton
                  icon="trash"
                  label={`Remove ${repo.name}`}
                  disabled={busy !== null}
                  onClick={() => void remove(repo)}
                />
              </div>
            </li>
          );
        })}
      </ul>

      {wizardRepo !== undefined && (
        <RepositoryWizard
          key={wizardRepo?.id ?? 'new'}
          repo={wizardRepo}
          onCancel={() => setWizardRepo(undefined)}
          onSaved={() => {
            setWizardRepo(undefined);
            repos.reload();
          }}
        />
      )}
    </Section>
  );
}

function transportLabel(transport: RepoTransport | undefined): string {
  return transport === 'ssh' ? 'SSH' : 'HTTPS';
}

function ConnectionResult({ result }: { result: TestConnectionResponse }) {
  return (
    <div className={styles.result} role="status">
      <span className={result.git.ok ? styles.resultOk : styles.resultFail}>
        Git: {result.git.ok ? 'OK' : 'failed'} — {result.git.message}
      </span>
      <span className={result.api.ok ? styles.resultOk : styles.resultFail}>
        API: {result.api.ok ? 'OK' : 'failed'} — {result.api.message}
      </span>
    </div>
  );
}

type WizardProps = {
  repo: RepoView | null;
  onCancel: () => void;
  onSaved: () => void;
};

function RepositoryWizard({ repo, onCancel, onSaved }: WizardProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [source, setSource] = useState<'local' | 'remote'>(repo?.kind === 'remote' ? 'remote' : 'local');
  const [paste, setPaste] = useState(repo !== null);
  const [path, setPath] = useState(repo !== null && repo.kind === 'local' ? repo.path : '');
  const [url, setUrl] = useState(
    repo !== null && repo.remote !== null ? `https://${repo.remote.host}/${repo.remote.project}` : '',
  );
  const [transport, setTransport] = useState<RepoTransport | null>(repo?.transport ?? null);
  const [token, setToken] = useState('');
  const [hostScope, setHostScope] = useState(repo?.tokenScope === 'host');
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TestConnectionResponse | null>(null);
  const saved = useRef<RepoView | null>(null);
  const saving = useRef<Promise<RepoView> | null>(null);

  const host = repo?.remote?.host ?? remoteHost(source === 'remote' ? url : '');
  const sourceReady = source === 'remote' ? url.trim() !== '' : path.trim() !== '';

  const choose = async () => {
    setPicking(true);
    setError(null);
    try {
      const answer = await apiSend('POST', '/api/fs/pick-folder', {}, PickFolderResponseSchema);
      if (answer.path !== null) {
        setPath(answer.path);
      }
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setPicking(false);
    }
  };

  const connectionBody = () => ({
    transport: transport ?? 'https',
    tokenScope: hostScope ? ('host' as const) : ('repo' as const),
    ...(token.trim() === '' ? {} : { token: token.trim() }),
  });

  const saveNow = async (): Promise<RepoView> => {
    if (repo !== null) {
      const updated = await apiSend('PUT', `/api/repos/${repo.id}/connection`, connectionBody(), RepoViewSchema);
      saved.current = updated;
      return updated;
    }
    if (source === 'remote') {
      const created = await apiSend(
        'POST',
        '/api/repos/remote',
        {
          url: url.trim(),
          transport: transport ?? 'https',
          tokenScope: hostScope ? 'host' : 'repo',
          ...(token.trim() === '' ? {} : { token: token.trim() }),
        },
        RepoViewSchema,
      );
      saved.current = created;
      return created;
    }
    const created = await apiSend('POST', '/api/repos', { path: path.trim() }, RepoViewSchema);
    const updated = await apiSend('PUT', `/api/repos/${created.id}/connection`, connectionBody(), RepoViewSchema);
    saved.current = updated;
    return updated;
  };

  /** Step 3 may test and then save; both must create the repository exactly once. */
  const persist = (): Promise<RepoView> => {
    if (saved.current !== null) {
      return Promise.resolve(saved.current);
    }
    const pending = saving.current ?? saveNow();
    saving.current = pending;
    return pending;
  };

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setBusy(false);
    }
  };

  const testConnection = () =>
    run(async () => {
      const stored = await persist();
      setResult(await apiSend('POST', `/api/repos/${stored.id}/test-connection`, {}, TestConnectionResponseSchema));
    });

  /** Going back discards the "already saved" memo so a changed connection is written again. */
  const back = (): void => {
    saved.current = null;
    saving.current = null;
    setStep((current) => (current === 3 ? 2 : 1));
  };

  const finish = () =>
    run(async () => {
      await persist();
      onSaved();
    });

  return (
    <section className={styles.wizard} aria-label="Add repository">
      <div className={styles.wizardHead}>
        <h3>{repo === null ? 'Add repository' : `Edit ${repo.name}`}</h3>
        <span className={styles.hint}>Step {step} of 3</span>
      </div>

      {step === 1 && (
        <div className={styles.wizardBody}>
          <p className={styles.stepTitle}>Source</p>
          <div className={styles.radioRow}>
            <label className={styles.radio}>
              <input
                type="radio"
                name="repository-source"
                checked={source === 'local'}
                disabled={repo !== null}
                onChange={() => setSource('local')}
              />
              Local folder
            </label>
            <label className={styles.radio}>
              <input
                type="radio"
                name="repository-source"
                checked={source === 'remote'}
                disabled={repo !== null}
                onChange={() => setSource('remote')}
              />
              Remote URL
            </label>
          </div>

          {source === 'local' ? (
            <div className={styles.field}>
              <label className={styles.radio}>
                <input type="checkbox" checked={paste} disabled={repo !== null} onChange={(event) => setPaste(event.target.checked)} />
                Paste path
              </label>
              {paste ? (
                <input
                  className={styles.textInput}
                  aria-label="Folder path"
                  placeholder="C:\work\project"
                  value={path}
                  spellCheck={false}
                  disabled={repo !== null}
                  onChange={(event) => setPath(event.target.value)}
                />
              ) : (
                <Button onClick={() => void choose()} disabled={picking} aria-busy={picking}>
                  {picking ? 'Waiting for the folder dialog…' : 'Choose folder'}
                </Button>
              )}
              {path !== '' && <code className={styles.mono}>{path}</code>}
            </div>
          ) : (
            <div className={styles.field}>
              <input
                className={styles.textInput}
                aria-label="Repository URL"
                placeholder="https://github.com/owner/repository"
                value={url}
                spellCheck={false}
                disabled={repo !== null}
                onChange={(event) => setUrl(event.target.value)}
              />
            </div>
          )}
        </div>
      )}

      {step === 2 && (
        <div className={styles.wizardBody}>
          <p className={styles.stepTitle}>Connection (required)</p>
          <fieldset className={styles.radioRow}>
            <legend className={styles.hint}>Git transport</legend>
            <label className={styles.radio}>
              <input
                type="radio"
                name="git-transport"
                checked={transport === 'ssh'}
                onChange={() => setTransport('ssh')}
              />
              SSH — use my SSH keys
            </label>
            <label className={styles.radio}>
              <input
                type="radio"
                name="git-transport"
                checked={transport === 'https'}
                onChange={() => setTransport('https')}
              />
              HTTPS — use a token
            </label>
          </fieldset>

          {transport === 'https' ? (
            <div className={styles.field}>
              <label className={styles.label} htmlFor="repository-token">
                Token
              </label>
              <input
                id="repository-token"
                className={styles.textInput}
                type="password"
                aria-label="Token"
                autoComplete="off"
                value={token}
                onChange={(event) => setToken(event.target.value)}
              />
              {host !== null && (
                <label className={styles.radio}>
                  <input type="checkbox" checked={hostScope} onChange={(event) => setHostScope(event.target.checked)} />
                  Use the {host} token for all repositories
                </label>
              )}
            </div>
          ) : (
            <p className={styles.hint}>Git uses your own SSH keys or agent; ravi never reads them.</p>
          )}

          <p className={styles.hint}>
            GitHub: Pull requests (read/write) + Contents (read). GitLab: <code>api</code> scope.
          </p>
        </div>
      )}

      {step === 3 && (
        <div className={styles.wizardBody}>
          <p className={styles.stepTitle}>Test connection</p>
          <p className={styles.hint}>
            {source === 'remote' ? url : path} · {transport === null ? 'no transport' : transportLabel(transport)} ·{' '}
            {hostScope ? 'host token' : 'repository token'}
          </p>
          <div className={styles.wizardActions}>
            <Button onClick={() => void testConnection()} disabled={busy} aria-busy={busy}>
              Test connection
            </Button>
          </div>
          {result !== null && <ConnectionResult result={result} />}
        </div>
      )}

      {error !== null && (
        <p className={styles.fieldError} role="alert">
          {error}
        </p>
      )}

      <div className={styles.wizardActions}>
        <Button onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <span className={styles.spacer} />
        {step > 1 && (
          <Button onClick={back} disabled={busy}>
            Back
          </Button>
        )}
        {step < 3 && (
          <Button
            variant="primary"
            disabled={step === 1 ? !sourceReady : transport === null}
            onClick={() => setStep((current) => (current === 1 ? 2 : 3))}
          >
            Continue
          </Button>
        )}
        {step === 3 && (
          <Button variant="primary" onClick={() => void finish()} disabled={busy} aria-busy={busy}>
            Save
          </Button>
        )}
      </div>
    </section>
  );
}

/**
 * Best-effort host for the token help text and the "use for all repositories" choice.
 * The server validates the real URL; this only decides which label to show before saving.
 */
function remoteHost(url: string): string | null {
  const match = /^(?:https?:\/\/|ssh:\/\/git@|git@)([^/:]+)/i.exec(url.trim());
  return match?.[1]?.toLowerCase() ?? null;
}
