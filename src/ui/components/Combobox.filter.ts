/**
 * The pure part of the ref picker: which rows match what was typed, and which typed text is a
 * usable value on its own. Kept out of the component so the rules can be tested without a DOM.
 */

export type ComboboxOption = {
  value: string;
  label: string;
  /** Heading the row belongs to, e.g. "Branches" or "Commits". */
  group?: string;
  /** Extra text shown after the label; it is searchable too, e.g. a commit subject. */
  detail?: string;
};

/** Above this the DOM would hold rows nobody reads; the rest is a hint to keep typing. */
export const MAX_RESULTS = 100;

export type ComboboxFilter = {
  /** Matches for the visible list, capped at `MAX_RESULTS`. */
  options: ComboboxOption[];
  /** Matches beyond the cap. */
  hidden: number;
  /**
   * Text accepted as the value when nothing matched and custom values are allowed. That is how a
   * commit id typed by hand reaches the range picker, which has no way to preload every sha.
   */
  custom: string | null;
};

export function filterOptions(options: readonly ComboboxOption[], query: string, allowCustom = false): ComboboxFilter {
  const needle = query.trim().toLowerCase();
  const matches =
    needle === ''
      ? [...options]
      : options.filter(
          (option) =>
            option.label.toLowerCase().includes(needle) || (option.detail?.toLowerCase().includes(needle) ?? false),
        );
  return {
    options: matches.slice(0, MAX_RESULTS),
    hidden: Math.max(0, matches.length - MAX_RESULTS),
    custom: allowCustom && needle !== '' && matches.length === 0 ? query.trim() : null,
  };
}
