# Architecture overview

## Runtime model

`revu` is one Node process and one browser tab.

- `dist/revu.mjs` contains the server, its dependencies and the built UI (gzip, embedded).
- The server listens on `127.0.0.1` only, serves the UI and a JSON API under `/api`.
- Git is used by spawning the `git` executable; there is no git library.
- Forges (GitHub, GitLab) are reached with the built-in `fetch`.
- A second `revu` invocation finds the running instance and only opens the browser.

## Module layout

| Path | Responsibility |
|---|---|
| `src/shared/` | API contract: Zod schemas and derived types used by server and UI |
| `src/server/cli.ts` | Argument parsing, single-instance check, server start |
| `src/server/app.ts` | Composition root: registers every API route |
| `src/server/http/` | Router, security checks, embedded UI serving |
| `src/server/store/` | JSON file persistence (validated read, atomic write) |
| `src/server/git/` | Everything that runs `git` |
| `src/server/forges/` | Forge strategy, host registry, facade |
| `src/server/review/` | Comment model, Markdown codec, draft outbox |
| `src/ui/app/` | App shell, API client, routing |
| `src/ui/features/` | One folder per feature (repos, diff, comments, pulls, settings) |
| `scripts/` | Dev server, build finishing step, test fixtures |

Dependencies point one way: `ui → shared ← server`. Features do not import each other's internals.

## Data folder

Everything lives in `~/.revu` (override with `REVU_HOME`):

| Path | Content |
|---|---|
| `.env` | Forge tokens. Written by the user, only read by revu |
| `data/session-token` | Secret that authorises the browser tab |
| `data/instance.json` (runtime) | Port and pid of the running server |
| `data/*.json` | Settings, connected repositories, review-later list |
| `data/reviews/` | Local comments and unsent drafts |
| `data/assets/` | Images attached to comments |
| `clones/` | Partial clones of remote repositories without a local folder |

## Security model

The server holds forge tokens and can run git, so it defends against other web pages:

- Loopback bind only.
- `Host` header must be the server's own address (DNS rebinding).
- API calls need the session cookie; the CLI opens `/?token=…`, the server sets an HttpOnly cookie and redirects.
- Mutating calls need the `x-revu` header (CSRF).
- File paths are validated against the repository root; git arguments are passed as an array, never through a shell.

The implementation and rationale live in `src/server/http/security.ts`.

## Build

`pnpm build` runs three steps: Vite builds the UI to `dist/ui`, a second Vite (SSR) build bundles the
server and embeds `dist/ui` through the `virtual:ui-assets` module, and `scripts/finish-build.ts`
writes the launchers and removes `dist/ui`.
