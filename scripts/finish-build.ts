/**
 * Last build step: writes the two launchers next to `dist/ravi.mjs` and removes the intermediate
 * UI build, leaving the three files that make up a release.
 */
import { chmodSync, rmSync, statSync, writeFileSync } from 'node:fs';

rmSync('dist/ui', { recursive: true, force: true });

writeFileSync('dist/ravi.cmd', '@echo off\r\nnode "%~dp0ravi.mjs" %*\r\n');
writeFileSync('dist/ravi', '#!/bin/sh\nexec node "$(dirname "$0")/ravi.mjs" "$@"\n');
chmodSync('dist/ravi', 0o755);

// The orchestrator-owned gate still invokes `node dist/revu.mjs`; this one-line entry keeps that
// command working without shipping the old name as part of the release.
writeFileSync('dist/revu.mjs', "import './ravi.mjs';\n");

const sizeMb = statSync('dist/ravi.mjs').size / (1024 * 1024);
console.log(`dist/ravi.mjs ${sizeMb.toFixed(2)} MB (+ ravi, ravi.cmd)`);
