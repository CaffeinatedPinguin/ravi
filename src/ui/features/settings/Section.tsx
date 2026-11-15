/** One boxed settings section with a heading; shared so every section looks the same. */
import type { ReactNode } from 'react';
import styles from './SettingsPage.module.css';

export function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const id = `settings-${title.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <section className={styles.section} aria-labelledby={id}>
      <div className={styles.sectionHead}>
        <h2 id={id}>{title}</h2>
        <span className={styles.spacer} />
        {action}
      </div>
      {children}
    </section>
  );
}
