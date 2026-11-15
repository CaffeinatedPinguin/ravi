# 0004 — Tokens written from Settings

- Status: accepted
- Date: 2026-11-15
- Superseded-by: none

## Context

Earlier releases required the user to edit `~/.revu/.env` by hand to add a forge token. That made
the first pull request fail with a file-editing step, and it offered no way to keep a separate token
for one repository or to rotate a host token without restarting revu. The tokens still must never
appear in the UI, logs, exports or the process environment.

## Decision

`~/.revu/.env` remains the only token store and the only file revu reads. Settings now writes it:

- **Settings → Accounts** sets or removes the token for `github.com` or `gitlab.com`
  (`GITHUB_TOKEN`, `GITLAB_TOKEN`).
- **Settings → Repositories** can set a token for one repository (`REVU_TOKEN_<REPOID>`) or
  explicitly choose the host token for it.

The only writer is `src/server/forges/env-write.ts`. It edits the file line by line so comments,
ordering and unrelated variables survive, writes a temporary file with mode 0600 and renames it
over the old one, then drops the in-process cache so the next API call sees the new value. The file
is never parsed and reprinted.

Tokens are still read only from that file; `process.env` is ignored. A route may report `hasToken`
and the last four characters (`tokenHint`), never the value.

## Consequences

- A user can connect a forge and a repository without touching a file by hand.
- Existing hand-edited files keep working; users may still edit them and use **Reload .env**.
- Rotation takes effect immediately, without a restart.
- A failed write leaves the previous file intact and never exposes a partially written token.
- On Windows, file modes are advisory; the 0600 mode is enforced on POSIX systems.

## Links

- `src/server/forges/env-write.ts`
- `docs/architecture/forges.md`
