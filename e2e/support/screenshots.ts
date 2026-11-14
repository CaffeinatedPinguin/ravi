/**
 * Screenshots for the orchestrator: every screen is captured in light and dark. The theme is saved
 * through the settings API (the same control the UI writes) and the page is reloaded, so the
 * screenshot shows the real themed UI rather than a hand-patched element.
 */
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

const THEMES = ['light', 'dark'] as const;
type Theme = (typeof THEMES)[number];

const directory = (): string => resolve(process.env.REVU_E2E_SCREENS ?? '.e2e-out/screens');

export async function shot(page: Page, baseUrl: string, name: string): Promise<void> {
  const target = directory();
  mkdirSync(target, { recursive: true });
  for (const theme of THEMES) {
    await saveTheme(page, baseUrl, theme);
    await page.reload();
    await page.waitForLoadState('networkidle');
    // The theme is applied after `/api/settings` answers; an auto-retrying assertion handles that.
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await page.screenshot({ path: join(target, `${name}-${theme}.png`) });
  }
}

async function saveTheme(page: Page, baseUrl: string, theme: Theme): Promise<void> {
  const settings = (await (await page.request.get(`${baseUrl}/api/settings`)).json()) as Record<string, unknown>;
  const response = await page.request.put(`${baseUrl}/api/settings`, {
    data: { ...settings, theme },
    headers: { 'x-revu': '1' },
  });
  if (!response.ok()) {
    throw new Error(`Cannot save the ${theme} theme: HTTP ${response.status()}`);
  }
}
