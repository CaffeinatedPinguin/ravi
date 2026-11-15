<p align="center"><img src="src/ui/public/brand/logo.svg" width="96" alt="revu logo"></p>

# revu

revu is a local code review tool with a GitHub/GitLab-like UI. It reviews local git changes and
GitHub.com/GitLab.com pull requests, keeps every comment as a draft, exchanges comments with AI
agents as one Markdown file, and writes to the forge only when you press **Send**. It ships as a
single JavaScript file that runs on Node, with the UI embedded.

## Features

- **Dashboard** — connected repositories, local changes, pull requests waiting for your review,
  your own pull requests, other open ones, and a review-later list.
- **Local review** — uncommitted, staged, unstaged, branch against base and commit ranges, with a
  file tree, split/unified view, syntax highlighting, ignore whitespace, expandable context and the
  whole file.
- **Pull request review** — GitHub.com and GitLab.com, file threads and the pull request
  conversation, review-later, and a three-dot diff like the forge's "Files changed" view.
- **Comments** — drafts, replies, edits, images, comments on the pull request itself, outdated
  markers, and Approve / Request changes.
- **Markdown v1** — Copy, Save and Import one self-explaining file for AI agents; see
  [the review format](docs/specs/review-format.md).
- **Notifications** — a background poller with author and text filters and a filter preview.
- **Security** — a loopback-only server, session cookie, CSRF header, strict security headers, a
  server image proxy, and tokens that never reach the browser.
- **Performance** — virtualized diff rendering that stays smooth with thousands of changed files.

## Install

revu needs Node 22.20 or newer and git.

Download a release archive and copy `revu.mjs`, `revu` and `revu.cmd` into one folder on your
`PATH`, or use the installer, which installs revu into `~/.revu/bin`:

```sh
./install/install.sh          # Linux, macOS
```

```powershell
./install/install.ps1         # Windows
```

To build from source instead:

```sh
pnpm install
pnpm build
./install/install.sh          # or ./install/install.ps1 on Windows
```

You can also run the built file directly: `node dist/revu.mjs`.

## Quick start

```sh
revu                # open the repository in the current folder
revu path/to/repo   # open another folder
revu --help
```

On first run revu opens the dashboard and asks you to add a repository. Choose a local folder or
paste a GitHub/GitLab URL. A remote repository without a local folder becomes an app-managed
partial clone; unused clones are removed after the retention period in Settings.

A second `revu` invocation reuses the running server and only opens the browser.

## Tokens and SSH

Open **Settings → Accounts** and save a token for `github.com` or `gitlab.com`. The repository
connection step in **Settings → Repositories** can store a token for one repository instead.
Tokens are written to `~/.revu/.env`, only the last four characters are ever shown again, and revu
never reads a token from the process environment.

GitHub fine-grained token scopes:

- **Pull requests**: read and write
- **Contents**: read

GitLab personal access token scope: `api`.

Git transport is chosen per repository:

- **SSH** — revu injects nothing; git uses your own keys and agent.
- **HTTPS** — revu passes the token to git through `GIT_CONFIG_*` environment variables, never
  through arguments.

Forge APIs always need a token. A repository token can also live in `~/.revu/.env` as
`REVU_TOKEN_<REPOID>`; Settings writes that variable for you.

## Notifications

revu polls the connected repositories in the background (5 minutes by default). The inbox has a
manual **Check now** action. Filters mute bots, mute authors, restrict notifications to chosen
authors, and include or exclude text; a preview shows how many recent comments a filter would
match.

## Markdown for AI agents

**Copy** puts the whole review on the clipboard, **Save** downloads it as a `*.review.md` file, and
**Import** merges a file, pasted text or a dropped file back into the review. The format is plain
Markdown with one `##` section per comment and a quoted code context, so an AI agent can read it
and add comments in the same shape. The grammar is in
[docs/specs/review-format.md](docs/specs/review-format.md).

## Security model

- The server binds `127.0.0.1` only and checks the `Host` header.
- API calls need a session cookie; mutating calls also need the `x-revu` header (CSRF).
- Tokens live only in `~/.revu/.env`; they are never logged, exported or sent to the UI.
- Git arguments are passed as an array, never through a shell; paths are validated against the
  repository root.
- Comment images are served from `~/.revu/data/assets` or through a server-side proxy with an
  allowlist of forge hosts.
- Nothing is written to GitHub/GitLab except through Send/Approve with a confirmation. Every Send
  appends counts only to `~/.revu/data/send-log.jsonl`, never comment bodies.

The full design is in [docs/architecture/overview.md](docs/architecture/overview.md).

## Develop

```sh
pnpm install
pnpm dev            # API on :4784, UI with hot reload on http://localhost:5173
pnpm test           # Vitest
pnpm typecheck
pnpm lint
pnpm e2e            # Playwright in Microsoft Edge (build first)
pnpm bench          # server-side benchmark on a throwaway repository
pnpm build          # dist/revu.mjs + revu and revu.cmd launchers
```

Architecture and decisions start at [docs/index.md](docs/index.md). Rules for AI agents are in
[AGENTS.md](AGENTS.md).

## License

Copyright (C) 2026 smrodek.xyz. Licensed under the GNU Affero General Public License v3.0 only; see [LICENSE](LICENSE). If you run a modified revu as a network service, you must offer its source to its users.

## Author

Made by [smrodek.xyz](https://smrodek.xyz).
