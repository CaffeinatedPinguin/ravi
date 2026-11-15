/**
 * A small action menu: one trigger button and a list below it.
 *
 * The keyboard model is local to the component (ArrowUp/ArrowDown wrap, Enter activates, Escape
 * closes) so later features can reuse it without pulling in a dependency or a second pattern.
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Button } from './controls.tsx';
import { Icon } from './Icon.tsx';
import styles from './Menu.module.css';

export type MenuItem = {
  label: string;
  disabled?: boolean;
  onSelect: () => void;
};

export type MenuKeyAction =
  | { type: 'move'; index: number }
  | { type: 'activate'; index: number }
  | { type: 'close' };

/**
 * Maps a key to the next menu state. Pure so the index wrapping and activation are unit-testable:
 * ArrowDown after the last row returns the first, ArrowUp before the first returns the last.
 */
export function menuKeyAction(key: string, active: number, count: number): MenuKeyAction | null {
  if (key === 'Escape') {
    return { type: 'close' };
  }
  if (count === 0) {
    return null;
  }
  switch (key) {
    case 'ArrowDown':
      return { type: 'move', index: active < 0 ? 0 : (active + 1) % count };
    case 'ArrowUp':
      return { type: 'move', index: active <= 0 ? count - 1 : active - 1 };
    case 'Home':
      return { type: 'move', index: 0 };
    case 'End':
      return { type: 'move', index: count - 1 };
    case 'Enter':
      return active >= 0 && active < count ? { type: 'activate', index: active } : null;
    default:
      return null;
  }
}

type MenuProps = {
  /** Visible trigger label; also the accessible name of the list. */
  label: string;
  items: readonly MenuItem[];
  disabled?: boolean;
  title?: string;
};

export function Menu({ label, items, disabled = false, title }: MenuProps) {
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  const focusTrigger = useCallback(() => {
    rootRef.current?.querySelector<HTMLButtonElement>(':scope > button')?.focus();
  }, []);

  const close = useCallback(
    (returnFocus: boolean) => {
      setOpen(false);
      setActive(-1);
      if (returnFocus) {
        focusTrigger();
      }
    },
    [focusTrigger],
  );

  // Focus follows the highlighted row: a screen reader announces it, and Space (the native button
  // activation) works on the row the user sees highlighted.
  useEffect(() => {
    if (open && active >= 0) {
      itemRefs.current[active]?.focus();
    }
  }, [open, active]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      // `pointerdown` runs before the trigger's click, so an outside click closes exactly once.
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        close(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, close]);

  const choose = (item: MenuItem) => {
    if (item.disabled === true) {
      return;
    }
    close(true);
    item.onSelect();
  };

  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const action = menuKeyAction(event.key, active, items.length);
    if (action === null) {
      return;
    }
    event.preventDefault();
    if (action.type === 'close') {
      close(true);
    } else if (action.type === 'move') {
      setActive(action.index);
    } else {
      const item = items[action.index];
      if (item !== undefined) {
        choose(item);
      }
    }
  };

  return (
    <div ref={rootRef} className={styles.menu}>
      <Button
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title={title}
        disabled={disabled}
        onClick={() => {
          setActive(-1);
          setOpen((value) => !value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
            setActive(event.key === 'ArrowDown' ? 0 : items.length - 1);
          } else if (event.key === 'Escape' && open) {
            event.preventDefault();
            close(true);
          }
        }}
      >
        {label}
        <Icon name="chevronDown" />
      </Button>
      {open && (
        <div id={menuId} role="menu" aria-label={label} className={styles.list} onKeyDown={onListKeyDown}>
          {items.map((item, index) => (
            <button
              key={item.label}
              ref={(node) => {
                itemRefs.current[index] = node;
              }}
              type="button"
              role="menuitem"
              className={styles.item}
              disabled={item.disabled}
              data-active={index === active ? '' : undefined}
              onMouseEnter={() => setActive(index)}
              onClick={() => choose(item)}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
