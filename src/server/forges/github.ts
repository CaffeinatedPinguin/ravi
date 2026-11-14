/**
 * GitHub strategy skeleton. The URLs and capabilities are final; the network methods are filled in
 * by the next task. Keeping the factory here means the registry never branches on the forge kind.
 */
import type { Forge, ForgeHost } from './forge.ts';
import { notImplemented } from './forge.ts';
import type { ForgeHttp } from './http.ts';
import { fileWebUrl } from './urls.ts';

export function createGitHubForge(host: ForgeHost, http: ForgeHttp): Forge {
  // Wired now so the next task only adds the method bodies.
  void http;
  return {
    kind: 'github',
    capabilities: {
      imageUpload: false,
      requestChanges: true,
      threadedPrComments: false,
      resolveThreads: true,
    },
    currentUser: notImplemented,
    pullRequestRef: (number) => `pull/${number}/head`,
    webUrl: (repo, sha, path, line) => fileWebUrl(host.webUrl, repo.project, sha, path, line, '/blob/'),
    cloneUrl: (repo) => `${host.webUrl}/${repo.project}.git`,
    listPullRequests: notImplemented,
    getPullRequest: notImplemented,
    listThreads: notImplemented,
    submit: notImplemented,
  };
}
