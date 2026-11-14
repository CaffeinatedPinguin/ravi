/**
 * Keys the local review understands. The list lives outside the page so the `?` dialog cannot
 * drift from the key handling, and so it can be asserted without rendering the whole screen.
 */
import type { Shortcut } from '../../components/ShortcutsDialog.tsx';

export const LOCAL_REVIEW_SHORTCUTS: readonly Shortcut[] = [
  { keys: 'j / k', description: 'Next / previous file' },
  { keys: 'r', description: 'Reload changes' },
  { keys: 'c', description: 'Comment on the focused line' },
  { keys: 'Shift + C', description: 'Copy review Markdown for AI' },
  { keys: 'Shift + S', description: 'Save review Markdown' },
  { keys: 'Shift + I', description: 'Import review Markdown' },
  { keys: '?', description: 'Show this dialog' },
];
