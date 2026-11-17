/**
 * Last build step: copies the three installers next to `dist/ravi.mjs` and removes the
 * intermediate UI build, leaving the four files that make up a release. The installers write
 * the `ravi` launcher themselves, so the build does not ship one.
 */
import { copyFileSync, rmSync, statSync } from 'node:fs';

const INSTALLERS = ['install-windows.ps1', 'install-macos.sh', 'install-linux.sh'];

rmSync('dist/ui', { recursive: true, force: true });

for (const name of INSTALLERS) {
  copyFileSync(`install/${name}`, `dist/${name}`);
}

const sizeMb = statSync('dist/ravi.mjs').size / (1024 * 1024);
console.log(`dist/ravi.mjs ${sizeMb.toFixed(2)} MB (+ ${INSTALLERS.join(', ')})`);
