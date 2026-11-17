/** App shell: picks the screen from the URL and handles the folder passed by the CLI. */
import { useCallback, useEffect, useState } from 'react';
import { RepoSchema } from '../../shared/api.ts';
import type { Repo } from '../../shared/api.ts';
import { ToastHost, showToast } from '../components/Toast.tsx';
import { DashboardPage } from '../features/dashboard/DashboardPage.tsx';
import { InboxPage } from '../features/dashboard/InboxPage.tsx';
import { PullRequestPage } from '../features/pulls/PullRequestPage.tsx';
import { PullsPage } from '../features/pulls/PullsPage.tsx';
import { FoundReposDialog } from '../features/repositories/FoundReposDialog.tsx';
import { RepositoriesPage } from '../features/repositories/RepositoriesPage.tsx';
import { scanFolder } from '../features/repositories/scan.ts';
import { ReviewPage } from '../features/review/ReviewPage.tsx';
import { SettingsPage } from '../features/settings/SettingsPage.tsx';
import { apiSend } from './api.ts';
import { errorMessage } from './errors.ts';
import { navigate, useUrl } from './router.ts';
import { SettingsProvider } from './settings.tsx';

export function App() {
  const url = useUrl();
  const openFolder = useOpenFolder(url.searchParams.get('open'));
  const [dashboardKey, setDashboardKey] = useState(0);
  const pullMatch = /^\/repo\/([^/]+)\/pull\/(\d+)$/.exec(url.pathname);
  const pullsMatch = /^\/repo\/([^/]+)\/pulls$/.exec(url.pathname);
  const repoMatch = /^\/repo\/([^/]+)$/.exec(url.pathname);
  const settingsMatch = url.pathname === '/settings';
  const repositoriesMatch = url.pathname === '/repositories';
  const inboxMatch = url.pathname === '/inbox';

  const addedFound = (added: Repo[]): void => {
    openFolder.dismiss();
    const only = added.length === 1 ? added[0] : undefined;
    if (only !== undefined) {
      navigate(`/repo/${only.id}`, { replace: true });
    } else {
      // The dashboard already rendered its list; a fresh mount fetches the newly connected repositories.
      setDashboardKey((value) => value + 1);
    }
  };

  return (
    <SettingsProvider>
      {settingsMatch ? (
        <SettingsPage />
      ) : repositoriesMatch ? (
        <RepositoriesPage />
      ) : inboxMatch ? (
        <InboxPage />
      ) : pullMatch?.[1] !== undefined ? (
        <PullRequestPage key={pullMatch[0]} repoId={pullMatch[1]} number={Number(pullMatch[2])} />
      ) : pullsMatch?.[1] !== undefined ? (
        <PullsPage key={pullsMatch[1]} repoId={pullsMatch[1]} />
      ) : repoMatch?.[1] !== undefined ? (
        <ReviewPage
          key={repoMatch[1]}
          repoId={repoMatch[1]}
          targetParam={url.searchParams.get('t')}
          worktreeParam={url.searchParams.get('w')}
        />
      ) : (
        <DashboardPage key={dashboardKey} />
      )}
      {openFolder.found !== null && (
        <FoundReposDialog
          folder={openFolder.found.folder}
          found={openFolder.found.found}
          onAdded={addedFound}
          onCancel={openFolder.dismiss}
        />
      )}
      {/* One region for every page: the dashboard and the setup screen have no host of their own. */}
      <ToastHost />
    </SettingsProvider>
  );
}

type FoundInFolder = { folder: string; found: readonly string[] };

/**
 * `ravi <folder>` opens the app with `?open=<folder>`: connect that folder and go to its review.
 *
 * A folder that is not a repository itself may still hold repositories. Instead of a permanent
 * error, the scan offers them in a dialog; a folder with none gets one short toast.
 */
function useOpenFolder(folder: string | null): { found: FoundInFolder | null; dismiss: () => void } {
  const [found, setFound] = useState<FoundInFolder | null>(null);
  const dismiss = useCallback(() => setFound(null), []);

  useEffect(() => {
    if (folder === null) {
      return;
    }
    void (async () => {
      try {
        const repo = await apiSend('POST', '/api/repos', { path: folder }, RepoSchema);
        navigate(`/repo/${repo.id}`, { replace: true });
      } catch (reason: unknown) {
        const message = errorMessage(reason, 'Could not open the folder');
        // A failed scan means "nothing to offer", so both outcomes end with the same toast.
        const inside = await scanFolder(folder).catch(() => []);
        if (inside.length > 0) {
          setFound({ folder, found: inside });
        } else {
          showToast({ message }, 8000);
        }
        navigate('/', { replace: true });
      }
    })();
  }, [folder]);

  return { found, dismiss };
}
