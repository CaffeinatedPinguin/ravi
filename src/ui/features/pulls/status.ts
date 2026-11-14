/** The "this pull request changed" decision; only a successful status answer can raise the banner. */
import type { PullRequestStatus } from '../../../shared/api.ts';

export function pullRequestChanged(
  openedHeadSha: string,
  status: PullRequestStatus | null | undefined,
): boolean {
  // A failed poll leaves `status` undefined; never reload or warn because the forge was unreachable.
  return status !== null && status !== undefined && status.headSha !== openedHeadSha;
}
