import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReviewDocument, ReviewTarget } from '../../../shared/review.ts';
import { ReviewStore } from './reviewStore.ts';

const REPO_ID = 'a1b2c3d4';
const target: ReviewTarget = { kind: 'local', repoPath: 'C:/repo', target: 'uncommitted' };
const input = { path: 'src/a.ts', side: 'new' as const, line: 1, body: 'first' };

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => Promise.resolve(ok(documentFrom(init))));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('ReviewStore', () => {
  it('coalesces three quick edits into one save request', async () => {
    const store = new ReviewStore(REPO_ID, target);
    const id = store.add(input);
    store.edit(id, 'second');
    store.edit(id, 'third');
    store.edit(id, 'fourth');

    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(799);
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0] as [string, RequestInit] | undefined;
    expect(call?.[0]).toBe('/api/reviews/save');
    expect(call?.[1].body).toContain('fourth');
    expect(store.saveStatus).toBe('saved');
  });

  it('restores a removed comment at its original position on undo', () => {
    const store = new ReviewStore(REPO_ID, target);
    const first = store.add({ ...input, body: 'first' });
    const second = store.add({ ...input, body: 'second' });
    const third = store.add({ ...input, body: 'third' });

    const undo = store.remove(second);
    expect(store.document.comments.map((entry) => entry.id)).toEqual([first, third]);

    undo();
    expect(store.document.comments.map((entry) => entry.id)).toEqual([first, second, third]);
    expect(store.document.comments[1]?.body).toBe('second');
  });

  it('replaceDocument saves once after the debounce and its undo restores the previous document', async () => {
    const store = new ReviewStore(REPO_ID, target);
    store.add(input);
    await vi.advanceTimersByTimeAsync(800);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const previous = store.document;
    const merged: ReviewDocument = { ...previous, summary: 'imported summary' };
    const undo = store.replaceDocument(merged);

    expect(store.document.summary).toBe('imported summary');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(800);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    undo();
    expect(store.document).toBe(previous);
    await vi.advanceTimersByTimeAsync(800);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('sets error on a failed save and retry saves the document', async () => {
    fetchMock.mockResolvedValueOnce(error('disk full'));
    const store = new ReviewStore(REPO_ID, target);
    store.add(input);

    await vi.advanceTimersByTimeAsync(800);
    expect(store.saveStatus).toBe('error');
    expect(store.hasUnsaved).toBe(true);

    await store.retry();
    expect(store.saveStatus).toBe('saved');
    expect(store.hasUnsaved).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

function documentFrom(init: RequestInit | undefined): ReviewDocument {
  const raw = init?.body;
  if (typeof raw !== 'string') {
    throw new Error('Expected a JSON string body');
  }
  const body = JSON.parse(raw) as { document: ReviewDocument };
  return body.document;
}

function ok(body: ReviewDocument): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () => Promise.resolve(body),
  } as Response;
}

function error(message: string): Response {
  return {
    ok: false,
    status: 500,
    statusText: 'Server Error',
    json: () => Promise.resolve({ error: message }),
  } as Response;
}
