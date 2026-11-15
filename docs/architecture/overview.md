# Architecture overview

## Runtime model

`ravi` is one Node process and one browser tab.

- `dist/ravi.mjs` contains the server, its dependencies and the built UI (gzip, embedded).
- The server listens on `127.0.0.1` only, serves the UI and a JSON API under `/api`.
- Git is used by spawning the `git` executable; there is no git library.
- Forges (GitHub, GitLab) are reached with the built-in `fetch`.
- Comment images are served from the data folder or through a server-side proxy, so the browser
  never holds a forge token.
- A second `ravi` invocation finds the running instance and only opens the browser.

## Module layout

| Path | Responsibility |
|---|---|
| `src/shared/` | API contract: Zod schemas and derived types used by server and UI |
| `src/server/cli.ts` | Argument parsing, single-instance check, server start |
| `src/server/app.ts` | Composition root: registers every API route |
| `src/server/http/` | Router, security checks and headers, embedded UI serving |
| `src/server/store/` | JSON file persistence (validated read, atomic write) |
| `src/server/git/` | Everything that runs `git`, including clones and diffs |
| `src/server/forges/` | Forge strategy, host registry, facade, token file reader and writer |
| `src/server/pulls/` | Pull request lookup, open review, threads, review later, error handling |
| `src/server/notify/` | Background poller, filters, notification store |
| `src/server/review/` | Comment model, Markdown codec, merge, assets, draft outbox, store |
| `src/server/api/` | One route module per area, registered by `app.ts` |
| `src/ui/app/` | App shell, API client, routing |
| `src/ui/features/` | One folder per feature (repos, diff, comments, pulls, dashboard, notifications, review, settings) |
| `scripts/` | Dev server, build finishing step, benchmark, test fixtures |
| `e2e/` | Playwright tests in Microsoft Edge against the built `dist/ravi.mjs` |

Dependencies point one way: `ui → shared ← server`. Features do not import each other's internals.

## Data folder

Everything lives in `~/.ravi` (override with `RAVI_HOME`):

| Path | Content |
|---|---|
| `.env` | Forge tokens. Written only from Settings, with mode 0600, and read only from here |
| `data/session-token` | Secret that authorises the browser tab |
| `data/instance.json` (runtime) | Port and pid of the running server |
| `data/settings.json` | View, theme, tree width, clone retention and notification filters |
| `data/repos.json` | Connected local folders and remote clones, with transport and token scope |
| `data/review-later.json` | Pull requests marked to review later |
| `data/reviews/` | Local comments and unsent drafts, per repository and review target |
| `data/notifications.json` | Notification inbox, seen markers and the filter preview cache |
| `data/send-log.jsonl` | One line per Send: timestamp, counts and outcomes, never bodies or tokens |
| `data/assets/` | Images attached to comments |
| `clones/` | Partial clones of remote repositories without a local folder |

## Security model

The server holds forge tokens and can run git, so it defends against other web pages:

- Loopback bind only.
- `Host` header must be the server's own address (DNS rebinding).
- API calls need the session cookie; the CLI opens `/?token=…`, the server sets an HttpOnly cookie and redirects.
- Mutating calls need the `x-ravi` header (CSRF).
- File paths are validated against the repository root; git arguments are passed as an array, never through a shell.
- Tokens are read only from `~/.ravi/.env`; they are never returned to the UI, logged or exported.
- Comment images go through `/api/image-proxy` or `/api/assets/:id`, with a host allowlist,
  `nosniff` and a restrictive content security policy.

The implementation and rationale live in `src/server/http/security.ts`.

## Build

`pnpm build` runs three steps: Vite builds the UI to `dist/ui`, a second Vite (SSR) build bundles the
server and embeds `dist/ui` through the `virtual:ui-assets` module, and `scripts/finish-build.ts`
writes the launchers and removes `dist/ui`.

`pnpm e2e` starts the built `dist/ravi.mjs` and drives it with Playwright in Microsoft Edge against
a temporary repository and a loopback fake forge. `pnpm bench` times the server side of a huge diff
on a throwaway repository.
