/**
 * The notification rules, as one pure function.
 *
 * Text rules are deliberately plain `includes` checks on lower-cased strings. They are never
 * compiled to a regex: user input such as `.` or `.*` stays a literal substring, so a rule cannot
 * become a pattern, blow up the process (ReDoS) or leak into a command. The only regex in this
 * file is the fixed bot-login shape below; it is not built from input.
 */
import type { NotificationFilters } from '../../shared/notify.ts';

/** The part of a forge comment the rules need; keeping it small makes the function easy to test. */
export type NotifiableComment = {
  author: string;
  body: string;
};

/**
 * Order matters and is part of the contract: own comment, bots, muted authors, only-from,
 * excluded text, included text. A later allow rule must never resurrect an earlier deny.
 */
export function shouldNotify(comment: NotifiableComment, filters: NotificationFilters, me: string): boolean {
  const author = comment.author.toLowerCase();

  if (author === me.toLowerCase()) {
    return false;
  }
  if (filters.muteBots && isBot(author)) {
    return false;
  }
  if (filters.mutedAuthors.some((entry) => entry.toLowerCase() === author)) {
    return false;
  }
  if (filters.onlyFrom.length > 0 && !filters.onlyFrom.some((entry) => entry.toLowerCase() === author)) {
    return false;
  }

  const body = comment.body.toLowerCase();
  if (filters.excludeText.some((entry) => body.includes(entry.toLowerCase()))) {
    return false;
  }
  if (filters.includeText.length > 0 && !filters.includeText.some((entry) => body.includes(entry.toLowerCase()))) {
    return false;
  }
  return true;
}

/**
 * GitHub marks bots with a `[bot]` suffix; GitLab uses `project_<id>_bot…` and `group_<id>_bot…`
 * usernames (a suffix after `_bot` is possible, so this is a prefix test). The login has already
 * been lower-cased by `shouldNotify`, and this fixed pattern also accepts upper-case callers.
 */
export function isBot(login: string): boolean {
  const author = login.toLowerCase();
  return author.endsWith('[bot]') || /^(?:project|group)_\d+_bot/.test(author);
}
