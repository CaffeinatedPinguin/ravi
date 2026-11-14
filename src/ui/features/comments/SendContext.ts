/** The retry action a failed draft needs, supplied by the page that owns the send request. */
import { createContext, useContext } from 'react';

export type SendActions = {
  /** Resends a draft whose last send failed; the server keeps only failed drafts. */
  retry: (draftId: string) => void;
};

const SendActionsContext = createContext<SendActions | null>(null);

export const SendActionsProvider = SendActionsContext.Provider;

export function useSendActions(): SendActions | null {
  return useContext(SendActionsContext);
}
