/**
 * Types the review API contract in `src/shared/review.ts` does not carry.
 *
 * `POST /api/assets` is part of the review comment workflow, but the shared contract only models
 * the review document. Keeping the tiny response schema here avoids touching `src/shared`, which
 * another task owns.
 */
import { z } from 'zod';

export const AssetResponseSchema = z.object({ id: z.string().min(1) });
export type AssetResponse = z.infer<typeof AssetResponseSchema>;

/** Autosave state shown next to the reload control. */
export type SaveStatus = 'saved' | 'saving' | 'error';
