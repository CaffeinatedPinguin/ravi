import { describe, expect, it } from 'vitest';
import { reviewFileName } from './download.ts';

describe('reviewFileName', () => {
  it('combines the repository and the encoded target into a safe review name', () => {
    const name = reviewFileName('my repo', 'range:main..feat/x');
    expect(name).toBe('revu-my repo-range-main..feat-x.review.md');
    expect(name).not.toMatch(/[\\/:]/);
  });

  it('replaces path separators and other characters a file system rejects', () => {
    const name = reviewFileName('acme\\api', 'branch:release/1.0');
    expect(name).toBe('revu-acme-api-branch-release-1.0.review.md');
    expect(name).not.toMatch(/[\\/:]/);
  });
});
