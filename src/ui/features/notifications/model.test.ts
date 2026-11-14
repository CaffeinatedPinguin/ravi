import { describe, expect, it } from 'vitest';
import type { Notification } from '../../../shared/notify.ts';
import { desktopNotification, notificationTarget, notificationsToShow } from './model.ts';

const base: Notification = {
  id: 'github.com|o/r|1|c1',
  repoId: 'abcdef12',
  host: 'github.com',
  project: 'o/r',
  number: 7,
  prTitle: 'Fix the thing',
  threadId: 'thread-1',
  commentId: 'c1',
  author: 'alice',
  excerpt: 'Looks good',
  createdAt: '2026-11-14T10:00:00.000Z',
  read: false,
};

const item = (change: Partial<Notification>): Notification => ({ ...base, ...change });

describe('notificationsToShow', () => {
  it('stays quiet on the first load, when existing items are only the baseline', () => {
    expect(notificationsToShow(null, [item({ id: 'a' })], new Set())).toEqual([]);
  });

  it('raises only unread items that were not part of the previous poll', () => {
    const previous = new Set(['old']);
    const fresh = item({ id: 'fresh' });
    expect(notificationsToShow(previous, [item({ id: 'old' }), fresh, item({ id: 'read', read: true })], new Set())).toEqual([fresh]);
  });

  it('never raises the same item twice, even when it is still unread', () => {
    const previous = new Set<string>();
    const shown = new Set(['fresh']);
    expect(notificationsToShow(previous, [item({ id: 'fresh' })], shown)).toEqual([]);
  });
});

describe('desktopNotification', () => {
  it('carries the author and the plain excerpt, including markup characters', () => {
    const excerpt = '<img src=x onerror="alert(1)">';
    const message = desktopNotification(item({ excerpt }));
    expect(message.title).toBe('alice');
    expect(message.body).toBe('Fix the thing #7\n<img src=x onerror="alert(1)">');
    expect(message.tag).toBe(base.id);
  });
});

describe('notificationTarget', () => {
  it('opens the pull request with the thread query', () => {
    expect(notificationTarget(base)).toBe('/repo/abcdef12/pull/7?thread=thread-1');
  });
});
