/**
 * A compact searchable list: type to filter, ArrowUp/Down to move, Enter to choose, Escape to close.
 * It is a text input on purpose, so a range picker can still accept a commit id or a ref nobody listed.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { filterOptions } from './Combobox.filter.ts';
import type { ComboboxOption } from './Combobox.filter.ts';
import styles from './Combobox.module.css';

export type { ComboboxOption } from './Combobox.filter.ts';

type ComboboxProps = {
  /** Accessible name; there is no visible label in the dense top bars. */
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly ComboboxOption[];
  /** Accept typed text that matches no option as a value (commit ids, `HEAD~3`). */
  allowCustom?: boolean;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
};

export function Combobox({
  label,
  value,
  onChange,
  options,
  allowCustom = false,
  placeholder,
  disabled = false,
  className,
}: ComboboxProps) {
  const listId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  // `null` means "show the selected value"; a string is what the user is typing right now.
  const [search, setSearch] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const filtered = useMemo(() => filterOptions(options, search ?? '', allowCustom), [options, search, allowCustom]);
  const rows = filtered.options;
  const activeIndex = rows.length === 0 ? -1 : Math.min(active, rows.length - 1);
  const activeOption = activeIndex < 0 ? undefined : rows[activeIndex];
  const selected = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) {
      return;
    }
    listRef.current?.querySelector<HTMLElement>('[data-active]')?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex]);

  const selectedIndex = (): number => {
    const index = rows.findIndex((option) => option.value === value);
    return index < 0 ? 0 : index;
  };

  const openList = (index: number): void => {
    setOpen(true);
    setActive(index);
  };

  const close = (): void => {
    setOpen(false);
    setSearch(null);
  };

  const choose = (option: ComboboxOption): void => {
    onChange(option.value);
    close();
  };

  /** The typed text wins when custom values are allowed: the field must behave like a text box too. */
  const commitTyped = (): void => {
    if (allowCustom && search !== null && search.trim() !== '') {
      onChange(search.trim());
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) {
        openList(selectedIndex());
      } else if (rows.length > 0) {
        setActive(Math.min(activeIndex + 1, rows.length - 1));
      }
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        openList(selectedIndex());
      } else if (rows.length > 0) {
        setActive(Math.max(activeIndex - 1, 0));
      }
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (activeOption !== undefined) {
        choose(activeOption);
      } else if (filtered.custom !== null) {
        onChange(filtered.custom);
        close();
      } else {
        close();
      }
    } else if (event.key === 'Escape') {
      close();
    } else if (event.key === 'Tab') {
      close();
    }
  };

  const groups = useMemo(() => {
    const grouped: Array<{ name: string | undefined; rows: Array<{ option: ComboboxOption; index: number }> }> = [];
    rows.forEach((option, index) => {
      const last = grouped.at(-1);
      if (last !== undefined && last.name === option.group) {
        last.rows.push({ option, index });
      } else {
        grouped.push({ name: option.group, rows: [{ option, index }] });
      }
    });
    return grouped;
  }, [rows]);

  const optionId = (index: number): string => `${listId}-option-${index}`;

  return (
    <div className={[styles.combobox, className].filter(Boolean).join(' ')}>
      <input
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && activeIndex >= 0 ? optionId(activeIndex) : undefined}
        className={styles.input}
        value={search ?? selected?.label ?? value}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
        onFocus={(event) => {
          event.currentTarget.select();
          if (!disabled) {
            openList(selectedIndex());
          }
        }}
        onClick={() => {
          if (!open && !disabled) {
            openList(selectedIndex());
          }
        }}
        onChange={(event) => {
          setSearch(event.target.value);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => {
          commitTyped();
          close();
        }}
      />
      {open && !disabled && (
        <div ref={listRef} id={listId} role="listbox" aria-label={label} className={styles.list}>
          {rows.length === 0 && (
            <div className={styles.empty}>
              {filtered.custom !== null ? `Use “${filtered.custom}”` : 'No matches'}
            </div>
          )}
          {groups.map((group) => (
            <div key={group.name ?? ''} role="group" aria-label={group.name}>
              {group.name !== undefined && (
                <div className={styles.heading} aria-hidden="true">
                  {group.name}
                </div>
              )}
              {group.rows.map(({ option, index }) => (
                <div
                  key={`${option.group ?? ''}:${option.value}:${option.label}`}
                  id={optionId(index)}
                  role="option"
                  aria-selected={index === activeIndex}
                  data-active={index === activeIndex ? '' : undefined}
                  className={styles.option}
                  onMouseDown={(event) => {
                    // Keep focus in the input; otherwise the blur would close the list mid-click.
                    event.preventDefault();
                    choose(option);
                  }}
                >
                  <span className={styles.label}>{option.label}</span>
                  {option.detail !== undefined && <span className={styles.detail}>{option.detail}</span>}
                </div>
              ))}
            </div>
          ))}
          {filtered.hidden > 0 && <div className={styles.more}>+{filtered.hidden} more, keep typing</div>}
        </div>
      )}
    </div>
  );
}
