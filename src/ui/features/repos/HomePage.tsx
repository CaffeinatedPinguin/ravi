/** Start screen: review later, local folders, remote repositories and forge accounts. */
import { useEffect, useState } from 'react';
import { z } from 'zod';
import { DirListSchema, RepoListSchema, RepoSchema, ScanResultSchema } from '../../../shared/api.ts';
import { apiGet, apiSend } from '../../app/api.ts';
import { navigate } from '../../app/router.ts';
import { useAsync } from '../../app/useAsync.ts';
import { Button, IconButton } from '../../components/controls.tsx';
import { TopBarActions } from '../../components/TopBarActions.tsx';
import page from '../review/ReviewPage.module.css';
import styles from './HomePage.module.css';
import { AccountsSection } from './AccountsSection.tsx';
import { RemoteReposSection } from './RemoteReposSection.tsx';
import { ReviewLaterSection } from './ReviewLaterSection.tsx';

export function HomePage({ notice }: { notice: string | null }) {
  const repos = useAsync('repos', (signal) => apiGet('/api/repos', RepoListSchema, signal));
  const [path, setPath] = useState('');
  const [found, setFound] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const suggestions = useDirectorySuggestions(path);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const connect = (folder: string, open: boolean) =>
    run(async () => {
      const repo = await apiSend('POST', '/api/repos', { path: folder }, RepoSchema);
      setFound((previous) => previous?.filter((candidate) => candidate !== folder) ?? null);
      if (open) {
        navigate(`/repo/${repo.id}`);
      } else {
        repos.reload();
      }
    });

  const scan = () => run(async () => setFound(await apiSend('POST', '/api/repos/scan', { path }, ScanResultSchema)));

  const disconnect = (id: string) =>
    run(async () => {
      await apiSend('DELETE', `/api/repos/${id}`, undefined, z.undefined());
      repos.reload();
    });

  const localRepos = repos.data?.filter((repo) => repo.kind !== 'remote') ?? [];

  return (
    <>
      <header className={page.topBar}>
        <a
          className={page.brand}
          href="/"
          onClick={(event) => {
            event.preventDefault();
            navigate('/');
          }}
        >
          revu
        </a>
        <span className={page.spacer} />
        <TopBarActions />
      </header>
      <main className={styles.page}>
        <h1 className={styles.title}>revu</h1>

      <ReviewLaterSection repos={repos.data ?? []} />

      <section aria-labelledby="connect-heading">
        <h2 id="connect-heading">Connect a local folder</h2>
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            void connect(path, true);
          }}
        >
          <input
            className={styles.pathInput}
            aria-label="Folder path"
            placeholder="Path to a git repository, or a folder that holds several"
            list="directory-suggestions"
            value={path}
            spellCheck={false}
            onChange={(event) => setPath(event.target.value)}
          />
          <datalist id="directory-suggestions">
            {suggestions.map((suggestion) => (
              <option key={suggestion} value={suggestion} />
            ))}
          </datalist>
          <Button type="submit" variant="primary" disabled={busy || path.trim() === ''}>
            Connect
          </Button>
          <Button disabled={busy || path.trim() === ''} onClick={() => void scan()}>
            Find repositories inside
          </Button>
        </form>
        {(error ?? notice) !== null && (
          <p className={styles.error} role="alert">
            {error ?? notice}
          </p>
        )}
        {found !== null && (
          <ul className={styles.list} aria-label="Repositories found">
            {found.length === 0 && <li className={styles.empty}>No git repositories found in that folder.</li>}
            {found.map((folder) => (
              <li key={folder} className={styles.item}>
                <span className={styles.path}>{folder}</span>
                <Button disabled={busy} onClick={() => void connect(folder, false)}>
                  Connect
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="repos-heading">
        <h2 id="repos-heading">Local folders</h2>
        {repos.error !== null && <p className={styles.error}>{repos.error}</p>}
        {localRepos.length === 0 && <p className={styles.empty}>Nothing connected yet. Add a folder above, or run `revu` inside a repository.</p>}
        <ul className={styles.list}>
          {localRepos.map((repo) => (
            <li key={repo.id} className={styles.item}>
              <a
                className={styles.repoLink}
                href={`/repo/${repo.id}`}
                onClick={(event) => {
                  event.preventDefault();
                  navigate(`/repo/${repo.id}`);
                }}
              >
                <strong>{repo.name}</strong>
                <span className={styles.path}>{repo.path}</span>
              </a>
              <IconButton icon="trash" label={`Disconnect ${repo.name}`} disabled={busy} onClick={() => void disconnect(repo.id)} />
            </li>
          ))}
        </ul>
      </section>

      <RemoteReposSection repos={repos.data ?? []} onReposChanged={repos.reload} />

        <AccountsSection />
      </main>
    </>
  );
}

/** Sub-folders of the folder being typed, for the path input's autocomplete. */
function useDirectorySuggestions(path: string): string[] {
  const [loaded, setLoaded] = useState<{ parent: string; dirs: string[] }>({ parent: '', dirs: [] });
  // Suggestions change only when the parent folder changes, i.e. after a path separator is typed.
  const parent = path.slice(0, Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);

  useEffect(() => {
    if (parent === '') {
      return;
    }
    const controller = new AbortController();
    apiGet(`/api/fs/dirs?path=${encodeURIComponent(parent)}`, DirListSchema, controller.signal)
      .then((result) => setLoaded({ parent, dirs: result.dirs.map((name) => `${parent}${name}`) }))
      .catch(() => undefined);
    return () => controller.abort();
  }, [parent]);

  return loaded.parent === parent ? loaded.dirs : [];
}
