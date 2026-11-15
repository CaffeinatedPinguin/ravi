/**
 * Response shape owned by the dashboard. `src/shared/api.ts` is shared with in-flight tasks and
 * must not change here, so this mirrors `src/server/api/summary.ts`.
 */
import { z } from 'zod';

export const RepoSummarySchema = z.object({
  branch: z.string().nullable(),
  ahead: z.number().int().nullable(),
  behind: z.number().int().nullable(),
  uncommitted: z
    .object({
      files: z.number().int().nonnegative(),
      additions: z.number().int().nonnegative(),
      deletions: z.number().int().nonnegative(),
      untracked: z.number().int().nonnegative(),
    })
    .nullable(),
  lastCommit: z
    .object({
      sha: z.string(),
      subject: z.string(),
      date: z.string(),
    })
    .nullable(),
});
export type RepoSummary = z.infer<typeof RepoSummarySchema>;
