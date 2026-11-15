/**
 * Settings validation: notification filter entries and the default base branch. The rules come from
 * the shared contract, so an entry the UI accepts is exactly an entry the server accepts.
 */
import { DefaultBaseBranchSchema } from '../../../shared/api.ts';
import { AUTHOR_PATTERN, MAX_FILTER_ENTRIES, MAX_FILTER_TEXT } from '../../../shared/notify.ts';

export type EntryResult = { ok: true; value: string } | { ok: false; message: string };

export function validateListEntry(kind: 'author' | 'text', raw: string, existing: readonly string[]): EntryResult {
  const value = raw.trim();
  if (value === '') {
    return { ok: false, message: kind === 'author' ? 'Enter an author login.' : 'Enter a text snippet.' };
  }
  if (existing.length >= MAX_FILTER_ENTRIES) {
    return { ok: false, message: `At most ${MAX_FILTER_ENTRIES} entries.` };
  }
  if (kind === 'author') {
    if (!AUTHOR_PATTERN.test(value)) {
      return {
        ok: false,
        message: 'Use a GitHub or GitLab login: letters, digits, dots, dashes or underscores, starting with a letter or digit.',
      };
    }
  } else if (value.length > MAX_FILTER_TEXT) {
    return { ok: false, message: `At most ${MAX_FILTER_TEXT} characters.` };
  }
  if (existing.includes(value)) {
    return { ok: false, message: 'Already in the list.' };
  }
  return { ok: true, value };
}

/** Uses the shared schema, so the message shown here and the value the server accepts cannot drift. */
export function validateBaseBranch(raw: string): EntryResult {
  const parsed = DefaultBaseBranchSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Enter a valid branch name.' };
  }
  return { ok: true, value: parsed.data };
}

/**
 * Base a branch comparison starts from. A configured branch is used only when this repository has
 * it, so a review never asks git for a branch that is not there; otherwise the repository default.
 */
export function initialBaseBranch(
  setting: string | null,
  defaultBranch: string | null,
  branches: readonly string[],
): string | null {
  if (setting !== null && branches.includes(setting)) {
    return setting;
  }
  return defaultBranch;
}
