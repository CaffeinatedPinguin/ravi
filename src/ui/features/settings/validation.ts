/**
 * Settings list validation. The limits come from the shared contract, so an entry the UI accepts
 * is exactly an entry the server accepts: trim first, then count characters and logins.
 */
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
