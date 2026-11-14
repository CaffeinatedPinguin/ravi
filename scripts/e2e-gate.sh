#!/usr/bin/env bash
# Browser E2E step of the gate: the gate already ran `pnpm build`, so run the smoke tests against
# `dist/revu.mjs` in Edge and keep the screenshots where the orchestrator reviews them.
set -uo pipefail
cd "$(dirname "$0")/.."
export REVU_E2E_SCREENS=.task/out/screens
pnpm e2e
