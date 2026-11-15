import { describe, expect, it } from 'vitest';
import { filterOptions, MAX_RESULTS } from './Combobox.filter.ts';
import type { ComboboxOption } from './Combobox.filter.ts';

const OPTIONS: ComboboxOption[] = [
  { value: 'main', label: 'main', group: 'Branches' },
  { value: 'origin/main', label: 'origin/main', group: 'Remote branches' },
  { value: 'v1.0', label: 'v1.0', group: 'Tags', detail: 'Release candidate' },
  { value: 'abc1234', label: 'abc1234', group: 'Commits', detail: 'Fix the parser' },
];

const values = (result: ReturnType<typeof filterOptions>): string[] => result.options.map((option) => option.value);

describe('filterOptions', () => {
  it('matches label and detail as a case-insensitive substring', () => {
    expect(values(filterOptions(OPTIONS, 'MAIN'))).toEqual(['main', 'origin/main']);
    expect(values(filterOptions(OPTIONS, 'parser'))).toEqual(['abc1234']);
    expect(values(filterOptions(OPTIONS, 'RELEASE'))).toEqual(['v1.0']);
  });

  it('returns all options in order for an empty query', () => {
    expect(values(filterOptions(OPTIONS, ''))).toEqual(OPTIONS.map((option) => option.value));
    expect(values(filterOptions(OPTIONS, '   '))).toEqual(OPTIONS.map((option) => option.value));
  });

  it('accepts typed text as a custom value only when nothing matches and allowCustom is set', () => {
    const unmatched = filterOptions(OPTIONS, '  deadbeef  ', true);

    expect(unmatched.options).toEqual([]);
    expect(unmatched.custom).toBe('deadbeef');
    expect(filterOptions(OPTIONS, 'deadbeef').custom).toBeNull();
    // A real match is never replaced by the typed text, even with custom values enabled.
    expect(filterOptions(OPTIONS, 'main', true).custom).toBeNull();
  });

  it('caps the list at 100 rows and reports how many matches are left', () => {
    const many: ComboboxOption[] = Array.from({ length: MAX_RESULTS + 30 }, (_, index) => ({
      value: `ref-${index}`,
      label: `ref-${index}`,
    }));

    const result = filterOptions(many, '');

    expect(result.options).toHaveLength(MAX_RESULTS);
    expect(result.hidden).toBe(30);
    expect(result.options[0]?.value).toBe('ref-0');
    expect(result.options.at(-1)?.value).toBe(`ref-${MAX_RESULTS - 1}`);
  });
});
