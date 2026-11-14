/**
 * Response shapes owned by the pull request UI.
 *
 * `src/shared/api.ts` is shared with other in-flight tasks and must not change here, so the two
 * fields this screen needs on top of `PullRequestOpen` get a local schema that mirrors the server.
 */
import { z } from 'zod';
import { PullRequestOpenSchema } from '../../../shared/api.ts';
import { ForgeStatusSchema, PullRequestSummarySchema, ReviewActionSchema, SubmitResultSchema } from '../../../shared/forge.ts';
import { ReviewDocumentSchema } from '../../../shared/review.ts';

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

/** Mirrors `SendResponseSchema` in `src/server/api/send.ts`; the UI validates every response. */
export const SendResponseSchema = z.object({
  results: z.array(SubmitResultSchema),
  document: ReviewDocumentSchema,
  approval: z
    .object({
      action: ReviewActionSchema,
      ok: z.boolean(),
      error: z.string().optional(),
    })
    .nullable(),
});
export type SendResponse = z.infer<typeof SendResponseSchema>;
