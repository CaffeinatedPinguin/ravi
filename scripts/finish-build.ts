/**
 * Last build step: writes the two launchers next to `dist/revu.mjs` and removes the intermediate
 * UI build, leaving exactly the three files that make up a release.
 */
import { chmodSync, rmSync, statSync, writeFileSync } from 'node:fs';

rmSync('dist/ui', { recursive: true, force: true });

writeFileSync('dist/revu.cmd', '@echo off\r\nnode "%~dp0revu.mjs" %*\r\n');
writeFileSync('dist/revu', '#!/bin/sh\nexec node "$(dirname "$0")/revu.mjs" "$@"\n');
chmodSync('dist/revu', 0o755);

const sizeMb = statSync('dist/revu.mjs').size / (1024 * 1024);
console.log(`dist/revu.mjs ${sizeMb.toFixed(2)} MB (+ revu, revu.cmd)`);
