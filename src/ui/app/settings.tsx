/** Settings live on the server; this context loads them once and saves every change. */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { SettingsSchema } from '../../shared/api.ts';
import type { Settings } from '../../shared/api.ts';
import { apiGet, apiSend } from './api.ts';
import { errorMessage } from './errors.ts';

type SettingsContextValue = {
  settings: Settings;
  update: (change: Partial<Settings>) => void;
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet('/api/settings', SettingsSchema)
      .then(setSettings)
      .catch((reason: unknown) => setError(errorMessage(reason, 'Could not load settings')));
  }, []);

  useEffect(() => {
    if (settings) {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      const theme = settings.theme === 'system' ? (prefersDark ? 'dark' : 'light') : settings.theme;
      document.documentElement.dataset.theme = theme;
    }
  }, [settings]);

  const update = useCallback((change: Partial<Settings>) => {
    setSettings((previous) => {
      if (!previous) {
        return previous;
      }
      const next = { ...previous, ...change };
      // Shown immediately; a failed save only means the choice is not remembered next time.
      apiSend('PUT', '/api/settings', next, SettingsSchema).catch(() => undefined);
      return next;
    });
  }, []);

  const value = useMemo(() => (settings ? { settings, update } : null), [settings, update]);

  if (error !== null) {
    return <p role="alert" style={{ padding: 24 }}>{error}</p>;
  }
  if (!value) {
    return null;
  }
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const value = useContext(SettingsContext);
  if (!value) {
    throw new Error('useSettings must be used inside SettingsProvider');
  }
  return value;
}
