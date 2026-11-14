/** App shell: picks the screen from the URL and handles the folder passed by the CLI. */
import { useEffect, useState } from 'react';
import { RepoSchema } from '../../shared/api.ts';
import { HomePage } from '../features/repos/HomePage.tsx';
import { ReviewPage } from '../features/review/ReviewPage.tsx';
import { apiSend } from './api.ts';
import { navigate, useUrl } from './router.ts';
import { SettingsProvider } from './settings.tsx';

export function App() {
  const url = useUrl();
  const openNotice = useOpenFolder(url.searchParams.get('open'));
  const repoMatch = /^\/repo\/([^/]+)$/.exec(url.pathname);

  return (
    <SettingsProvider>
      {repoMatch?.[1] !== undefined ? (
        <ReviewPage key={repoMatch[1]} repoId={repoMatch[1]} targetParam={url.searchParams.get('t')} />
      ) : (
        <HomePage notice={openNotice} />
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
