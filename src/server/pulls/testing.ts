/** A forge strategy whose methods are either stubbed or replaced per test, so no request leaves the process. */
import type { Forge } from '../forges/forge.ts';

export function fakeForge(overrides: Partial<Forge> = {}): Forge {
  return {
    kind: 'github',
    capabilities: {
      imageUpload: true,
      requestChanges: true,
      threadedPrComments: true,
      resolveThreads: true,
    },
    currentUser: () => Promise.resolve('octocat'),
    pullRequestRef: (number) => `pull/${number}/head`,
    webUrl: () => '',
    cloneUrl: () => '',
    listPullRequests: () => Promise.resolve([]),
    getPullRequest: () => Promise.reject(new Error('fake forge: getPullRequest was not stubbed')),
    listThreads: () => Promise.resolve([]),
    submit: () => Promise.resolve([]),
    ...overrides,
  };
}
