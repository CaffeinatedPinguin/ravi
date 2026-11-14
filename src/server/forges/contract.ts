/**
 * The contract every forge strategy must pass.
 *
 * The offline part (refs, URLs, capabilities) runs for skeletons too. The network part is enabled by
 * the strategy's own test once it wires a fake `fetch`: the fixtures supply the calls, so the suite
 * does not need to know how a particular forge paginates or submits.
 */
import { describe, expect, it } from 'vitest';
import type { RepoRef, SubmitResult } from '../../shared/forge.ts';
import type { Forge } from './forge.ts';
import type { FakeFetch } from './testing.ts';

/** What a strategy test must provide. Omit `network` while the strategy is still a skeleton. */
export type ForgeContractFixtures = {
  /** Builds a strategy; called once per assertion group. */
  create: () => Forge;
  /** A repository the strategy can address. */
  repo: RepoRef;
  /** Pull request used for ref checks; defaults to 1. */
  pullRequest?: number;
  /** Network checks, supplied only when the strategy has real network methods. */
  network?: {
    /** API base the fake `fetch` answers for. */
    apiUrl: string;
    /** Token that must be sent but must never appear in a status/error payload. */
    token: string;
    /** The fake fetch used by the client; its `calls` list is asserted here. */
    fetch: FakeFetch;
    /** Reads every page of a fixture collection. */
    paginate: () => Promise<unknown[]>;
    /** Expected number of items across all pages. */
    expectedItems: number;
    /** Reads a fixture whose `next` link points at another origin. */
    foreignNext: () => Promise<unknown>;
    /** Submits a fixture containing one operation the forge rejects. */
    failedSubmit: () => Promise<SubmitResult[]>;
  };
};

export function describeForgeContract(name: string, fixtures: ForgeContractFixtures): void {
  const { repo } = fixtures;
  const number = fixtures.pullRequest ?? 1;

  describe(name, () => {
    it('builds a pull request ref that ends with the number and head', () => {
      expect(fixtures.create().pullRequestRef(number)).toMatch(new RegExp(`/${number}/head$`));
    });

    it('builds a web URL for a file at a commit with an encoded path and a line anchor', () => {
      const url = fixtures.create().webUrl(repo, 'abcdef123456', 'src/hello world.ts', 12);
      expect(url.startsWith('https://')).toBe(true);
      expect(url).toContain(repo.project);
      expect(url).toContain('abcdef123456');
      expect(url).toContain('hello%20world.ts');
      expect(url).toMatch(/#L12$/);
    });

    it('builds a clone URL for the project', () => {
      const url = fixtures.create().cloneUrl(repo);
      expect(url.startsWith('https://')).toBe(true);
      expect(url).toMatch(new RegExp(`${escapeRegExp(repo.project)}\\.git$`));
    });

    it('exposes forge-neutral capabilities', () => {
      const { capabilities } = fixtures.create();
      expect(typeof capabilities.imageUpload).toBe('boolean');
      expect(typeof capabilities.requestChanges).toBe('boolean');
      expect(typeof capabilities.threadedPrComments).toBe('boolean');
      expect(typeof capabilities.resolveThreads).toBe('boolean');
    });

    if (fixtures.network !== undefined) {
      const network = fixtures.network;

      it('follows pagination and sends the token header', async () => {
        const items = await network.paginate();
        expect(items).toHaveLength(network.expectedItems);
        const headers = network.fetch.calls.flatMap((call) => Object.values(call.headers));
        expect(headers.some((value) => value.includes(network.token))).toBe(true);
      });

      it('never sends a request to another origin', async () => {
        await network.foreignNext();
        const origin = new URL(network.apiUrl).origin;
        expect(network.fetch.calls.every((call) => new URL(call.url).origin === origin)).toBe(true);
      });

      it('reports per-operation failures without throwing', async () => {
        const results = await network.failedSubmit();
        expect(results.length).toBeGreaterThan(0);
        expect(results.some((result) => !result.ok && result.error !== undefined)).toBe(true);
      });
    }
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
