/** App settings: appearance, review defaults, notifications and stored data. Saves immediately. */
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { NotificationPreviewSchema } from '../../../shared/api.ts';
import type { NotificationFilters, NotificationPreview, NotificationSettings } from '../../../shared/api.ts';
import { MAX_FILTER_ENTRIES } from '../../../shared/notify.ts';
import { apiSend } from '../../app/api.ts';
import { navigate } from '../../app/router.ts';
import { useSettings } from '../../app/settings.tsx';
import { Button, Segmented, Toggle } from '../../components/controls.tsx';
import { TopBarActions } from '../../components/TopBarActions.tsx';
import { debounce } from './debounce.ts';
import styles from './SettingsPage.module.css';
import { validateListEntry } from './validation.ts';

const messageOf = (reason: unknown): string => (reason instanceof Error ? reason.message : 'Something went wrong');

export function SettingsPage() {
  const { settings, update } = useSettings();
  const notifications = settings.notifications;
  const setNotifications = (change: Partial<NotificationSettings>) =>
    update({ notifications: { ...notifications, ...change } });
  const { permission, request } = usePermission();

  const filters = useMemo<NotificationFilters>(
    () => ({
      muteBots: notifications.muteBots,
      mutedAuthors: notifications.mutedAuthors,
      onlyFrom: notifications.onlyFrom,
      includeText: notifications.includeText,
      excludeText: notifications.excludeText,
    }),
    [notifications],
  );

  const setEnabled = (enabled: boolean) => {
    setNotifications({ enabled });
    if (enabled) {
      // The permission prompt is allowed only from this direct click, never from a timer.
      request();
    }
  };

  return (
    <div className={styles.page}>
      <header className={styles.topBar}>
        <a
          className={styles.brand}
          href="/"
          onClick={(event) => {
            event.preventDefault();
            navigate('/');
          }}
        >
          revu
        </a>
        <span className={styles.topTitle}>Settings</span>
        <span className={styles.spacer} />
        <TopBarActions />
      </header>

      <main className={styles.body}>
        <h1 className={styles.heading}>Settings</h1>
        <p className={styles.lead}>Every change is saved as you make it.</p>

        <Section title="Appearance">
          <Row label="Theme">
            <Segmented
              label="Theme"
              value={settings.theme}
              options={[
                { value: 'system', label: 'System' },
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' },
              ]}
              onChange={(theme) => update({ theme })}
            />
          </Row>
          <Row label="Diff layout" hint="Split puts old and new side by side; unified interleaves them.">
            <Segmented
              label="Diff layout"
              value={settings.viewMode}
              options={[
                { value: 'unified', label: 'Unified', icon: 'unified' },
                { value: 'split', label: 'Split', icon: 'split' },
              ]}
              onChange={(viewMode) => update({ viewMode })}
            />
          </Row>
        </Section>

        <Section title="Review">
          <div className={styles.row}>
            <Toggle checked={settings.ignoreWhitespace} onChange={(ignoreWhitespace) => update({ ignoreWhitespace })}>
              Ignore whitespace by default
            </Toggle>
            <span className={styles.hint}>Used when a review opens; the toolbar can still change it.</span>
          </div>
          <div className={styles.row}>
            <Toggle checked={settings.showUntracked} onChange={(showUntracked) => update({ showUntracked })}>
              Show untracked files
            </Toggle>
            <span className={styles.hint}>Only affects comparisons that include the working tree.</span>
          </div>
          <Row label="Lines revealed per expand click" hint="1–500.">
            <input
              className={styles.number}
              type="number"
              min={1}
              max={500}
              aria-label="Expand step"
              value={settings.expandStep}
              onChange={(event) => setInteger(event.target.value, 1, 500, (expandStep) => update({ expandStep }))}
            />
          </Row>
          <Row label="Link mode">
            <Segmented
              label="Link mode"
              value={settings.linkMode}
              options={[
                { value: 'path', label: 'Path' },
                { value: 'url', label: 'URL' },
              ]}
              onChange={(linkMode) => update({ linkMode })}
            />
          </Row>
        </Section>

        <Section title="Notifications">
          <div className={styles.row}>
            <Toggle checked={notifications.enabled} onChange={setEnabled}>
              Desktop notifications
            </Toggle>
            <span className={styles.hint}>{permissionHint(permission)}</span>
          </div>
          {permission === 'denied' && (
            <p className={styles.fieldError} role="alert">
              Desktop notifications are blocked for this site. Open the browser&apos;s site settings (the icon next to the
              address), allow notifications for revu, then reload this page.
            </p>
          )}
          <Row
            label="Server poll interval"
            hint="1–60 minutes. The inbox still checks once a minute while revu is open."
          >
            <input
              className={styles.number}
              type="number"
              min={1}
              max={60}
              aria-label="Poll interval in minutes"
              value={notifications.pollMinutes}
              onChange={(event) =>
                setInteger(event.target.value, 1, 60, (pollMinutes) => setNotifications({ pollMinutes }))
              }
            />
          </Row>
          <div className={styles.row}>
            <Toggle checked={notifications.muteBots} onChange={(muteBots) => setNotifications({ muteBots })}>
              Mute bot authors
            </Toggle>
            <span className={styles.hint}>GitHub [bot] accounts and GitLab *[_]bot accounts are ignored.</span>
          </div>

          <TagList
            kind="author"
            label="Muted authors"
            hint="GitHub or GitLab logins. Their comments never notify."
            values={notifications.mutedAuthors}
            onChange={(mutedAuthors) => setNotifications({ mutedAuthors })}
          />
          <TagList
            kind="author"
            label="Only from"
            hint="When not empty, only these authors notify."
            values={notifications.onlyFrom}
            onChange={(onlyFrom) => setNotifications({ onlyFrom })}
          />
          <TagList
            kind="text"
            label="Include text"
            hint="Plain text, not case sensitive. A comment must contain one of these."
            values={notifications.includeText}
            onChange={(includeText) => setNotifications({ includeText })}
          />
          <TagList
            kind="text"
            label="Exclude text"
            hint="Plain text, not case sensitive. Comments containing one of these never notify."
            values={notifications.excludeText}
            onChange={(excludeText) => setNotifications({ excludeText })}
          />
          <Preview filters={filters} />
        </Section>

        <Section title="Data">
          <Row label="Keep cached clones for" hint="Days since last use. Older clones are removed on startup.">
            <input
              className={styles.number}
              type="number"
              min={1}
              max={3650}
              aria-label="Clone retention days"
              value={settings.cloneRetentionDays}
              onChange={(event) =>
                setInteger(event.target.value, 1, 3650, (cloneRetentionDays) => update({ cloneRetentionDays }))
              }
            />
          </Row>
          <p className={styles.hint}>
            The cached clone list with sizes and delete buttons is on the{' '}
            <a
              href="/"
              onClick={(event) => {
                event.preventDefault();
                navigate('/');
              }}
            >
              start page
            </a>
            .
          </p>
        </Section>
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.section} aria-labelledby={`settings-${title.replace(/\s+/g, '-').toLowerCase()}`}>
      <h2 id={`settings-${title.replace(/\s+/g, '-').toLowerCase()}`}>{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className={styles.row}>
      <span className={styles.rowText}>
        <span className={styles.rowLabel}>{label}</span>
        {hint !== undefined && <span className={styles.hint}>{hint}</span>}
      </span>
      {children}
    </div>
  );
}

function TagList({
  kind,
  label,
  hint,
  values,
  onChange,
}: {
  kind: 'author' | 'text';
  label: string;
  hint: string;
  values: string[];
  onChange: (values: string[]) => void;
}) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const add = (): void => {
    const result = validateListEntry(kind, draft, values);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setError(null);
    setDraft('');
    onChange([...values, result.value]);
  };

  return (
    <div className={styles.tagField}>
      <span className={styles.rowLabel}>{label}</span>
      <span className={styles.hint}>{hint}</span>
      {values.length > 0 && (
        <ul className={styles.tagList} aria-label={label}>
          {values.map((value, index) => (
            <li key={`${value}-${String(index)}`} className={styles.tag}>
              <span>{value}</span>
              <button
                type="button"
                className={styles.tagRemove}
                aria-label={`Remove ${value} from ${label}`}
                onClick={() => onChange(values.filter((_, position) => position !== index))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className={styles.tagInputRow}>
        <input
          aria-label={`Add to ${label}`}
          value={draft}
          placeholder="Add an entry and press Enter"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              add();
            }
          }}
        />
        <Button onClick={add} disabled={values.length >= MAX_FILTER_ENTRIES}>
          Add
        </Button>
      </div>
      {error !== null && (
        <p className={styles.fieldError} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function Preview({ filters }: { filters: NotificationFilters }) {
  const [preview, setPreview] = useState<NotificationPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = useMemo(
    () =>
      debounce((value: NotificationFilters) => {
        setBusy(true);
        void apiSend('POST', '/api/notifications/preview', { filters: value }, NotificationPreviewSchema)
          .then((result) => {
            setPreview(result);
            setError(null);
          })
          .catch((reason: unknown) => setError(messageOf(reason)))
          .finally(() => setBusy(false));
      }, 350),
    [],
  );

  useEffect(() => {
    run(filters);
  }, [filters, run]);
  useEffect(() => () => run.cancel(), [run]);

  return (
    <p className={styles.preview} role="status">
      {error !== null
        ? `Preview failed: ${error}`
        : preview === null || busy
          ? 'Checking how many comments would notify…'
          : `Would notify ${String(preview.matched)} of the last ${String(preview.total)} comments.`}
    </p>
  );
}

type Permission = NotificationPermission | 'unsupported';

function usePermission(): { permission: Permission; request: () => void } {
  const [permission, setPermission] = useState<Permission>(() =>
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
  );

  const request = (): void => {
    if (typeof Notification === 'undefined') {
      return;
    }
    void Notification.requestPermission().then(setPermission);
  };

  return { permission, request };
}

function permissionHint(permission: Permission): string {
  if (permission === 'granted') {
    return 'Allowed by this browser.';
  }
  if (permission === 'denied') {
    return 'Blocked by this browser.';
  }
  if (permission === 'default') {
    return 'The browser asks when you switch this on.';
  }
  return 'This browser does not support desktop notifications.';
}

/** Reject out-of-range values; keeping the last valid number avoids saving a broken setting. */
function setInteger(raw: string, min: number, max: number, save: (value: number) => void): void {
  const value = Number(raw);
  if (Number.isInteger(value) && value >= min && value <= max) {
    save(value);
  }
}
