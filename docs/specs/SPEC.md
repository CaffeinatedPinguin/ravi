# revu — product spec

## Goal

Review code locally with a GitHub/GitLab-like UI: local git changes and GitHub.com/GitLab.com pull
requests, with comments that can be exchanged with AI agents and sent to the forge on demand.

## Requirements

- Review local changes: working tree, staged, untracked, branch against base, commit range.
- Browse pull/merge requests of connected repositories, comment, reply, edit, approve.
- Nothing is sent to a forge until the user presses Send; until then everything is a draft.
- Copy, save and import all comments in one self-explaining Markdown format.
- File tree, syntax highlighting, split and unified view, ignore whitespace.
- Expand context around a change by N lines and show the whole file.
- Stay smooth with thousands of changed files.
- Diff size (`+X −Y`, file count) in the header.
- Comments on the pull request itself, not only on files.
- Images in comments (local reviews and GitLab; not GitHub for now).
- Per-file and per-comment link, switchable between repository URL and file path.
- Switch between connected repositories and local folders.
- Mark a pull request to review later.
- Remember settings, connected repositories, local folders and the review-later list.
- Tokens only from `~/.revu/.env`; Settings → Accounts and the repository connection step write
  that file.
- Remote repositories without a local folder use an app-managed partial clone that can be cleaned up.
- New forges can be added as one strategy file plus one registry entry.

## Non-goals

- Self-hosted forges in the first version (the design allows adding them).
- Image upload to GitHub pull requests.
- Editing code or running CI.

## Phases

- [x] 0 — Skeleton: repo, tooling, docs, single-file build, launchers, CLI opens the app.
- [x] 1 — Local diff: connect folders, diff targets, file list and stats, tree, virtualized split/unified
      renderer, highlighting worker, expand context, whole file, ignore whitespace, persistent settings.
- [x] 2 — Local comments and the Markdown format: add, edit, delete, reply, images, outdated; Copy / Save / Import.
- [x] 3 — Forge read: strategy + registry, tokens, remote repositories, partial clones and cleanup,
      pull request list, review later, pull request diff, threads, conversation tab, link mode.
- [x] 4 — Forge write: draft outbox, Send with Comment / Approve / Request changes, partial failure and retry,
      GitLab image upload.
- [x] 5 — Performance and release: benchmark on a generated huge repository, tuning, smoke tests on
      Linux and Windows, release archive, README.

Each phase ends with `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build` and a run of the built file.

## Known gaps

- GitHub does not accept comment images through its API, so image upload is local and GitLab only.
- Only github.com and gitlab.com are registered; self-hosted instances are not supported in v1.
- macOS is not covered yet; browser tests run in Edge on Windows.
