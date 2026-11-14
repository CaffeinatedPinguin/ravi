/**
 * GitLab strategy skeleton. The URLs and capabilities are final; the network methods are filled in
 * by the next task.
 */
import type { Forge, ForgeHost } from './forge.ts';
import { notImplemented } from './forge.ts';
import type { ForgeHttp } from './http.ts';
import { fileWebUrl } from './urls.ts';

export function createGitLabForge(host: ForgeHost, http: ForgeHttp): Forge {
  // Wired now so the next task only adds the method bodies.
  void http;
  return {
    kind: 'gitlab',
    capabilities: {
      imageUpload: true,
      requestChanges: false,
      threadedPrComments: true,
      resolveThreads: true,
    },
    currentUser: notImplemented,
    pullRequestRef: (number) => `merge-requests/${number}/head`,
    webUrl: (repo, sha, path, line) => fileWebUrl(host.webUrl, repo.project, sha, path, line, '/-/blob/'),
    cloneUrl: (repo) => `${host.webUrl}/${repo.project}.git`,
    listPullRequests: notImplemented,
    getPullRequest: notImplemented,
    listThreads: notImplemented,
    submit: notImplemented,
  };
}
