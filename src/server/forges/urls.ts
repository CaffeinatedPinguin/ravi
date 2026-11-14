/** URL shapes shared by the forge strategies. */

/**
 * Browser URL of a file at a commit. Path segments are encoded one by one so `/` stays a path
 * separator while spaces and `#` in a file name do not break the URL.
 */
export function fileWebUrl(
  webUrl: string,
  project: string,
  sha: string,
  path: string,
  line: number | undefined,
  marker: string,
): string {
  const encoded = path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  const anchor = line === undefined ? '' : `#L${line}`;
  return `${webUrl}/${project}${marker}${sha}/${encoded}${anchor}`;
}
