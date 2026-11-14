/**
 * Capabilities the composer needs without threading them through every diff row.
 *
 * `DiffRow` is outside this task's file scope, so the pull request page provides the forge
 * capabilities here and the composer reads them where it is rendered.
 */
import { createContext, useContext } from 'react';

export type ComposerCapabilities = { imageUpload: boolean; threadedPrComments: boolean };

const DEFAULT: ComposerCapabilities = { imageUpload: true, threadedPrComments: true };

export const ComposerCapabilitiesContext = createContext<ComposerCapabilities>(DEFAULT);

export function useComposerCapabilities(): ComposerCapabilities {
  return useContext(ComposerCapabilitiesContext);
}
