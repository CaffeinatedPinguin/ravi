/**
 * Response shapes owned by the pull request UI.
 *
 * `src/shared/api.ts` is shared with other in-flight tasks and must not change here, so the two
 * fields this screen needs on top of `PullRequestOpen` get a local schema that mirrors the server.
 */
import { z } from 'zod';
import { PullRequestOpenSchema } from '../../../shared/api.ts';
import { ForgeStatusSchema, PullRequestSummarySchema } from '../../../shared/forge.ts';

export const PullRequestOpenResponseSchema = PullRequestOpenSchema.extend({
  /** Forge file URL with `{path}` and `{line}` placeholders, built by the server. */
  fileUrlTemplate: z.string(),
  oldFileUrlTemplate: z.string(),
});
export type PullRequestOpenResponse = z.infer<typeof PullRequestOpenResponseSchema>;

/** The list route answers with the summaries only; the open response carries the details. */
export const PullRequestListSchema = z.array(PullRequestSummarySchema);

export const FileUrlTemplateSchema = z.object({
  fileUrlTemplate: z.string(),
  oldFileUrlTemplate: z.string(),
});
export type FileUrlTemplate = z.infer<typeof FileUrlTemplateSchema>;

export const ForgeStatusListSchema = z.array(ForgeStatusSchema);
