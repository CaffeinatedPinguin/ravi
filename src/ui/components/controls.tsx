/** The handful of form controls the app needs, built on native elements so keyboard and screen-reader behaviour comes for free. */
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Icon } from './Icon.tsx';
import type { IconName } from './Icon.tsx';
import styles from './controls.module.css';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'ghost';
  icon?: IconName;
};

export function Button({ variant = 'default', icon, children, className, ...props }: ButtonProps) {
  return (
    <button type="button" {...props} className={[styles.button, styles[variant], className].filter(Boolean).join(' ')}>
      {icon && <Icon name={icon} />}
      {children}
    </button>
  );
}

/** A button that shows only an icon; `label` is required because there is no visible text. */
export function IconButton({ icon, label, className, ...props }: Omit<ButtonProps, 'children' | 'icon'> & { icon: IconName; label: string }) {
  return (
    <button
      type="button"
      {...props}
      aria-label={label}
      title={label}
      className={[styles.button, styles.ghost, styles.iconOnly, className].filter(Boolean).join(' ')}
    >
      <Icon name={icon} />
    </button>
  );
}

type SegmentedOption<T extends string> = {
  value: T;
  label: string;
  icon?: IconName;
  /** Disabled options stay visible so the reason (a tooltip) can be read. */
  disabled?: boolean;
  title?: string;
};

type SegmentedProps<T extends string> = {
  label: string;
  value: T;
  options: ReadonlyArray<SegmentedOption<T>>;
  onChange: (value: T) => void;
};

/** A small group of mutually exclusive choices, e.g. split / unified. */
export function Segmented<T extends string>({ label, value, options, onChange }: SegmentedProps<T>) {
  return (
    <div role="radiogroup" aria-label={label} className={styles.segmented}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          aria-disabled={option.disabled === true ? true : undefined}
          title={option.title}
          disabled={option.disabled}
          className={styles.segment}
          onClick={() => onChange(option.value)}
        >
          {option.icon && <Icon name={option.icon} />}
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, children }: { checked: boolean; onChange: (checked: boolean) => void; children: ReactNode }) {
  return (
    <label className={styles.toggle}>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {children}
    </label>
  );
}
