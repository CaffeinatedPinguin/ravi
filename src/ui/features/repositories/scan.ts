/** Helpers for "find repositories inside a folder": the scan request and path comparison. */
import { ScanResultSchema } from '../../../shared/api.ts';
import { apiSend } from '../../app/api.ts';

/** Git working trees found below `folder`; the server stops at each repository root and skips junk folders. */
export function scanFolder(folder: string): Promise<string[]> {
  return apiSend('POST', '/api/repos/scan', { path: folder }, ScanResultSchema);
}

/**
 * Key that makes two spellings of one folder equal: git reports `C:/work/app`, the scan reports
 * `C:\work\app`, and Windows paths ignore case.
 */
export function pathKey(path: string): string {
  return path.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();
}

export function connectedKeys(repoPaths: readonly string[]): ReadonlySet<string> {
  return new Set(repoPaths.map(pathKey));
}
