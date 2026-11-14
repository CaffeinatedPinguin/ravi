import { afterEach, describe, expect, it, vi } from 'vitest';
import { readImportFile } from './importFile.ts';

let fetchMock: ReturnType<typeof vi.fn>;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('readImportFile', () => {
  it('returns the text of a valid Markdown file', async () => {
    const text = await readImportFile(new File(['# Review\n\nA comment'], 'notes.md', { type: 'text/markdown' }));
    expect(text).toBe('# Review\n\nA comment');
  });

  it('rejects a file over 2 MiB without a request', async () => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const file = new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'huge.md', { type: 'text/markdown' });

    await expect(readImportFile(file)).rejects.toThrow('2 MiB');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a non-text file before reading it', async () => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const file = new File(['%PDF-1.7'], 'review.pdf', { type: 'application/pdf' });

    await expect(readImportFile(file)).rejects.toThrow('.md or .txt');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
