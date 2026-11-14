import { afterEach, describe, expect, it, vi } from 'vitest';
import { debounce } from './debounce.ts';

afterEach(() => {
  vi.useRealTimers();
});

describe('debounce', () => {
  it('runs once for rapid edits, with the last value', () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    const run = debounce((value: string) => calls.push(value), 300);

    run('a');
    run('ab');
    run('abc');
    expect(calls).toEqual([]);

    vi.advanceTimersByTime(300);
    expect(calls).toEqual(['abc']);
  });

  it('cancel drops a pending run', () => {
    vi.useFakeTimers();
    const run = vi.fn();
    const debounced = debounce(run, 300);
    debounced();
    debounced.cancel();
    vi.advanceTimersByTime(300);
    expect(run).not.toHaveBeenCalled();
  });
});
