/** App shell: picks the screen from the URL and handles the folder passed by the CLI. */
import { useEffect, useState } from 'react';
import { RepoSchema } from '../../shared/api.ts';
import { DashboardPage } from '../features/dashboard/DashboardPage.tsx';
import { InboxPage } from '../features/dashboard/InboxPage.tsx';
import { PullRequestPage } from '../features/pulls/PullRequestPage.tsx';
import { PullsPage } from '../features/pulls/PullsPage.tsx';
import { ReviewPage } from '../features/review/ReviewPage.tsx';
import { SettingsPage } from '../features/settings/SettingsPage.tsx';
import { apiSend } from './api.ts';
import { navigate, useUrl } from './router.ts';
import { SettingsProvider } from './settings.tsx';

export function App() {
  const url = useUrl();
  const openNotice = useOpenFolder(url.searchParams.get('open'));
  const pullMatch = /^\/repo\/([^/]+)\/pull\/(\d+)$/.exec(url.pathname);
  const pullsMatch = /^\/repo\/([^/]+)\/pulls$/.exec(url.pathname);
  const repoMatch = /^\/repo\/([^/]+)$/.exec(url.pathname);
  const settingsMatch = url.pathname === '/settings';
  const inboxMatch = url.pathname === '/inbox';

  return (
    <SettingsProvider>
      {settingsMatch ? (
        <SettingsPage />
      ) : inboxMatch ? (
        <InboxPage />
      ) : pullMatch?.[1] !== undefined ? (
        <PullRequestPage key={pullMatch[0]} repoId={pullMatch[1]} number={Number(pullMatch[2])} />
      ) : pullsMatch?.[1] !== undefined ? (
        <PullsPage key={pullsMatch[1]} repoId={pullsMatch[1]} />
      ) : repoMatch?.[1] !== undefined ? (
        <ReviewPage key={repoMatch[1]} repoId={repoMatch[1]} targetParam={url.searchParams.get('t')} />
      ) : (
        <DashboardPage notice={openNotice} />
      )}
    </SettingsProvider>
  );
}

/**
 * `revu <folder>` opens the app with `?open=<folder>`: connect that folder and go to its review.
 * Returns a message when the folder is not a repository, so the start screen can explain.
 */
function useOpenFolder(folder: string | null): string | null {
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (folder === null) {
      return;
    }
    apiSend('POST', '/api/repos', { path: folder }, RepoSchema)
      .then((repo) => navigate(`/repo/${repo.id}`, { replace: true }))
      .catch((reason: unknown) => {
        setNotice(reason instanceof Error ? reason.message : 'Could not open the folder');
        navigate('/', { replace: true });
      });
  }, [folder]);

  return notice;
}
