/** Production entry point bundled into `dist/ravi.mjs`; the UI is embedded at build time. */
import encodedAssets from 'virtual:ui-assets';
import { run } from './cli.ts';
import { decodeUiAssets } from './http/static.ts';

run(process.argv.slice(2), { assets: decodeUiAssets(encodedAssets) }).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
