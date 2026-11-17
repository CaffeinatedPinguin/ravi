# AGENTS.md — ravi

ravi is a local code review tool with a GitHub/GitLab-like UI: review local git changes and
GitHub.com/GitLab.com pull requests, keep comments as drafts, exchange them with AI agents as
Markdown, and send them to the forge on demand. It ships as one JavaScript file that runs on Node.

Domain: ../ai/domains/frontend/AGENTS.md (generic rules; this file adds only local ones)

## Read when

| Task | Read |
|---|---|
| Understand the runtime, modules or data folder | `docs/architecture/overview.md` |
| Change packaging, runtime or dependencies | `docs/decisions/0001-stack-and-distribution.md` |
| Change the installers or the release files | `docs/decisions/0005-per-os-installers.md` |
| Change token storage or forge authentication | `docs/decisions/0004-tokens-written-from-settings.md` |
| Install and usage | `README.md` |
| Development commands | `## Verify` below |

## Local rules

- KISS first. Apply SOLID and DRY only where they make the code simpler; abstract on the second real use (AHA).
- New runtime dependencies need the owner's approval; prefer Node built-ins and small local code.
- The server may import only `node:*` modules and `zod`; everything must bundle into `dist/ravi.mjs`.
- Server code must run under Node's type stripping: erasable TypeScript only, relative imports end in `.ts`.
- `src/shared/` is the only contract between server and UI; every payload has a Zod schema there.
- Nothing is written to a forge except through the explicit Send action; all other edits stay drafts.
- Tokens live only in the `.env` file of the data folder (`~/.ravi`, or `RAVI_HOME` when set); Settings writes them there, ravi never reads them from the environment, and only the last four characters are shown again.
- Run git through the helpers in `src/server/git/`; never build a shell command string.
- Comment the "why" (forge API quirks, git behaviour, performance), not the "what".
- UI and review logic ask a forge for `capabilities`, never for its kind.

## Verify

- `pnpm test` — show command and output
- `pnpm typecheck && pnpm lint` — show command and output
- `pnpm e2e` — show command and output
- `pnpm build && node dist/ravi.mjs --version` — show command and output

## Never

- Commit `.env` files or tokens (enforced by pre-commit TruffleHog hook)
- Add `node_modules` or extra files to the release; the release is `ravi.mjs` and the three installers in `install/` (enforced by `scripts/finish-build.ts`).
- Make an installer unreadable: they are read by people, so keep numbered steps and English comments, plain ASCII, and explain every network access and every change to `PATH`.
