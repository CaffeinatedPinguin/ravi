# 0001 — Stack and distribution

- Status: accepted
- Date: 2026-11-14
- Superseded-by: none

## Context

revu must be trivial to install on Windows, Linux and macOS and must not scatter files: no
`node_modules`, no installer with many parts. Target machines already have Node installed.
Maintainability matters more than features, and the project is open source.

## Decision

Write the server and the UI in TypeScript, require Node ≥ 22, and ship one bundled file
(`revu.mjs`, UI embedded) plus two launcher scripts. Keep runtime dependencies to a short list of
widely used libraries: `react`, `react-dom`, `@tanstack/react-virtual`, `shiki`, `markdown-it`, `zod`.

## Consequences

- One artifact works on every OS; installing is copying three files.
- The server uses only Node built-ins and `zod`; no web framework, no git library, no database.
- UI components, icons, routing and data fetching are small local code instead of libraries.
- No native modules and no code that cannot be bundled into a single ESM file.
- Server sources must be valid under Node's type stripping, so development needs no extra runner.
- A new runtime dependency is an explicit decision by the owner.

## Links

- `vite.server.config.ts`
- `docs/architecture/overview.md`
