import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import type { Notification } from '../../shared/notify.ts';
import { Router } from '../http/router.ts';
import type { RequestContext } from '../http/router.ts';
import { resolvePaths } from '../paths.ts';
import type { Paths } from '../paths.ts';
import { writeJsonFile } from '../store/json-file.ts';
import { registerNotificationRoutes } from './notifications.ts';

const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeRouter(): { paths: Paths; router: Router } {
  const home = mkdtempSync(join(tmpdir(), 'revu-notifications-api-'));
  tempDirs.push(home);
  const paths = resolvePaths({ REVU_HOME: home });
  const router = new Router();
  registerNotificationRoutes(router, { paths });
  return { paths, router };
}

function notification(id: string, createdAt: string, read = false): Notification {
  return {
    id,
    repoId: 'a1b2c3d4',
    host: 'github.com',
    project: 'acme/api',
    number: 7,
    prTitle: 'Add b',
    threadId: 't1',
    commentId: id,
    author: 'alice',
    excerpt: 'hello',
    createdAt,
    read,
  };
}

async function seed(paths: Paths, items: Notification[]): Promise<void> {
  await writeJsonFile(join(paths.data, 'notifications.json'), { markers: {}, items, recent: [] });
}

function call(router: Router, method: string, path: string, payload?: unknown): Promise<unknown> {
  const match = router.match(method, path);
  if (match === null) {
    throw new Error(`No route ${method} ${path}`);
  }
  return Promise.resolve(
    match.handler({
      req: {} as RequestContext['req'],
      params: match.params,
      query: new URLSearchParams(),
      body: <S extends z.ZodType>(schema: S): Promise<z.infer<S>> => Promise.resolve(schema.parse(payload)),
    }),
  );
}

describe('notification routes', () => {
  it('marks ids read, then all, and updates unread', async () => {
    const { paths, router } = makeRouter();
    await seed(paths, [
      notification('n1', '2026-11-14T10:00:00.000Z'),
      notification('n2', '2026-11-14T10:01:00.000Z'),
    ]);

    expect(await call(router, 'GET', '/api/notifications')).toMatchObject({ unread: 2 });

    const afterIds = (await call(router, 'POST', '/api/notifications/read', { ids: ['n1'] })) as {
      unread: number;
    };
    expect(afterIds.unread).toBe(1);
    expect(await call(router, 'GET', '/api/notifications')).toMatchObject({ unread: 1 });

    const afterAll = (await call(router, 'POST', '/api/notifications/read', { all: true })) as {
      unread: number;
    };
    expect(afterAll.unread).toBe(0);
    expect(await call(router, 'GET', '/api/notifications')).toMatchObject({ unread: 0 });
  });

  it('returns at most 500 items, newest first', async () => {
    const { paths, router } = makeRouter();
    const base = Date.parse('2026-11-14T10:00:00.000Z');
    const items = Array.from({ length: 600 }, (_, index) =>
      notification(`n${index}`, new Date(base + index * 1000).toISOString()),
    );
    await seed(paths, items);

    const response = (await call(router, 'GET', '/api/notifications')) as {
      items: Notification[];
      unread: number;
    };

    expect(response.items).toHaveLength(500);
    expect(response.items[0]?.id).toBe('n599');
    expect(response.items.at(-1)?.id).toBe('n100');
    expect(response.unread).toBe(500);
  });

  it('counts the matching recent comments for a preview', async () => {
    const { paths, router } = makeRouter();
    await writeJsonFile(join(paths.data, 'notifications.json'), {
      markers: {},
      items: [],
      recent: [
        {
          id: 'r1',
          repoId: 'a1b2c3d4',
          host: 'github.com',
          project: 'acme/api',
          number: 7,
          author: 'alice',
          body: 'Please review',
          createdAt: '2026-11-14T10:00:00.000Z',
          viewer: 'octocat',
        },
        {
          id: 'r2',
          repoId: 'a1b2c3d4',
          host: 'github.com',
          project: 'acme/api',
          number: 7,
          author: 'octocat',
          body: 'my own review',
          createdAt: '2026-11-14T10:01:00.000Z',
          viewer: 'octocat',
        },
        {
          id: 'r3',
          repoId: 'a1b2c3d4',
          host: 'github.com',
          project: 'acme/api',
          number: 7,
          author: 'bob',
          body: 'unrelated',
          createdAt: '2026-11-14T10:02:00.000Z',
          viewer: 'octocat',
        },
      ],
    });

    const preview = (await call(router, 'POST', '/api/notifications/preview', {
      filters: { includeText: ['review'] },
    })) as { matched: number; total: number };

    expect(preview).toEqual({ matched: 1, total: 3 });
  });
});
