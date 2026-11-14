import { describe, expect, it } from 'vitest';
import { NotificationSettingsSchema, SettingsSchema } from '../../shared/api.ts';
import { NotificationFiltersSchema } from '../../shared/notify.ts';
import { isBot, shouldNotify } from './filter.ts';

const ME = 'octocat';

function filters(input: Record<string, unknown> = {}) {
  return NotificationFiltersSchema.parse(input);
}

describe('shouldNotify', () => {
  it('never notifies my own comment, even when every allow rule matches', () => {
    const rules = filters({ onlyFrom: ['octocat'], includeText: ['hello'] });
    expect(shouldNotify({ author: 'octocat', body: 'hello' }, rules, ME)).toBe(false);
    expect(shouldNotify({ author: 'OctoCat', body: 'hello' }, rules, ME)).toBe(false);
  });

  it('detects GitHub and GitLab bots and honours muteBots', () => {
    const muted = filters({ muteBots: true });
    for (const bot of ['dependabot[bot]', 'project_123_bot', 'project_123_bot_abc', 'group_45_bot', 'Group_45_BOT']) {
      expect(isBot(bot)).toBe(true);
      expect(shouldNotify({ author: bot, body: 'hi' }, muted, ME)).toBe(false);
    }

    const allowed = filters({ muteBots: false });
    expect(shouldNotify({ author: 'dependabot[bot]', body: 'hi' }, allowed, ME)).toBe(true);
  });

  it('does not treat a human login that merely contains bot characters as a bot', () => {
    expect(isBot('robot')).toBe(false);
    expect(isBot('project_abc_bot')).toBe(false);
    expect(shouldNotify({ author: 'robot', body: 'hi' }, filters(), ME)).toBe(true);
  });

  it('mutes authors case-insensitively', () => {
    const rules = filters({ mutedAuthors: ['MutedUser'] });
    expect(shouldNotify({ author: 'muteduser', body: 'hi' }, rules, ME)).toBe(false);
    expect(shouldNotify({ author: 'MUTEDUSER', body: 'hi' }, rules, ME)).toBe(false);
    expect(shouldNotify({ author: 'someone', body: 'hi' }, rules, ME)).toBe(true);
  });

  it('only notifies authors from onlyFrom when that list is non-empty', () => {
    const rules = filters({ onlyFrom: ['Alice'] });
    expect(shouldNotify({ author: 'bob', body: 'hi' }, rules, ME)).toBe(false);
    expect(shouldNotify({ author: 'alice', body: 'hi' }, rules, ME)).toBe(true);
    expect(shouldNotify({ author: 'ALICE', body: 'hi' }, rules, ME)).toBe(true);
  });

  it('drops comments whose body contains any excludeText, case-insensitively', () => {
    const rules = filters({ excludeText: ['Secret'] });
    expect(shouldNotify({ author: 'alice', body: 'a SECRET plan' }, rules, ME)).toBe(false);
    expect(shouldNotify({ author: 'alice', body: 'a public plan' }, rules, ME)).toBe(true);
  });

  it('requires one includeText when that list is non-empty', () => {
    const rules = filters({ includeText: ['needle'] });
    expect(shouldNotify({ author: 'alice', body: 'no match here' }, rules, ME)).toBe(false);
    expect(shouldNotify({ author: 'alice', body: 'a NEEDLE here' }, rules, ME)).toBe(true);
  });

  it('keeps the documented order: deny rules win over allow rules', () => {
    expect(
      shouldNotify(
        { author: 'alice', body: 'keep and drop' },
        filters({ includeText: ['keep'], excludeText: ['drop'] }),
        ME,
      ),
    ).toBe(false);

    expect(
      shouldNotify({ author: 'alice', body: 'hi' }, filters({ mutedAuthors: ['alice'], onlyFrom: ['alice'] }), ME),
    ).toBe(false);

    // A GitLab bot is muted before onlyFrom could allow it.
    expect(
      shouldNotify(
        { author: 'project_1_bot', body: 'hi' },
        filters({ muteBots: true, onlyFrom: ['project_1_bot'] }),
        ME,
      ),
    ).toBe(false);
  });

  it('treats every text rule as a literal, case-insensitive substring', () => {
    const literals = ["' OR 1=1 --", '%', '*', '.*', '\\', '$(rm -rf /)', '<script>'];
    for (const literal of literals) {
      const rules = filters({ includeText: [literal] });
      expect(shouldNotify({ author: 'alice', body: 'nothing to see' }, rules, ME)).toBe(false);
      expect(shouldNotify({ author: 'alice', body: `before ${literal} after` }, rules, ME)).toBe(true);
    }

    // A regex-style rule must not match text that only looks like a regex match.
    const regexLike = filters({ includeText: ['a.*b'] });
    expect(shouldNotify({ author: 'alice', body: 'a__b' }, regexLike, ME)).toBe(false);
    expect(shouldNotify({ author: 'alice', body: 'a.*b' }, regexLike, ME)).toBe(true);
  });
});

describe('notification settings validation', () => {
  it('fills every notification default for an old settings file', () => {
    const settings = SettingsSchema.parse({ viewMode: 'split' });
    expect(settings.notifications).toEqual({
      enabled: true,
      pollMinutes: 5,
      muteBots: true,
      mutedAuthors: [],
      onlyFrom: [],
      includeText: [],
      excludeText: [],
    });
  });

  it('trims text entries and accepts up to 100 author entries', () => {
    const rules = NotificationFiltersSchema.parse({ includeText: ['  hello  '] });
    expect(rules.includeText).toEqual(['hello']);
    expect(rules.mutedAuthors).toEqual([]);

    const authors = Array.from({ length: 100 }, (_, index) => `user${index}`);
    expect(NotificationFiltersSchema.safeParse({ mutedAuthors: authors }).success).toBe(true);
  });

  it('rejects a 101st entry in any list', () => {
    const authors = Array.from({ length: 101 }, (_, index) => `user${index}`);
    expect(NotificationFiltersSchema.safeParse({ mutedAuthors: authors }).success).toBe(false);
    expect(NotificationFiltersSchema.safeParse({ onlyFrom: authors }).success).toBe(false);
    expect(NotificationFiltersSchema.safeParse({ includeText: authors }).success).toBe(false);
  });

  it('rejects a 201-character text rule but keeps literal punctuation', () => {
    expect(NotificationFiltersSchema.safeParse({ includeText: ['x'.repeat(201)] }).success).toBe(false);
    expect(NotificationFiltersSchema.safeParse({ includeText: ['$(rm -rf /)'] }).success).toBe(true);
  });

  it('rejects author logins that could not exist on a forge', () => {
    for (const login of ['a b', '../x', '', '-starts-with-dash', 'x'.repeat(101)]) {
      expect(NotificationFiltersSchema.safeParse({ mutedAuthors: [login] }).success).toBe(false);
    }
    for (const login of ['octocat', 'a.b-c_d', 'project_12_bot']) {
      expect(NotificationFiltersSchema.safeParse({ mutedAuthors: [login] }).success).toBe(true);
    }
  });

  it('keeps pollMinutes between 1 and 60', () => {
    expect(NotificationSettingsSchema.safeParse({ pollMinutes: 0 }).success).toBe(false);
    expect(NotificationSettingsSchema.safeParse({ pollMinutes: 61 }).success).toBe(false);
    expect(NotificationSettingsSchema.safeParse({ pollMinutes: 60 }).success).toBe(true);
  });
});
