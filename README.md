<p align="center"><img src="src/ui/public/brand/logo.svg" width="96" alt="ravi logo"></p>

# ravi

ravi is a local code review tool with a GitHub/GitLab-like UI. It reviews local git changes and
GitHub.com/GitLab.com pull requests, keeps comments as drafts until you press **Send**, and exports
the whole review as one Markdown file that AI agents can read and extend. It ships as one JavaScript
file that runs on Node with the UI embedded.

[![CI workflow status](https://github.com/CaffeinatedPinguin/ravi/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/CaffeinatedPinguin/ravi/actions/workflows/ci.yml)
[![Latest version](https://img.shields.io/github/v/release/CaffeinatedPinguin/ravi?label=version)](https://github.com/CaffeinatedPinguin/ravi/releases/latest)
[![License](https://img.shields.io/github/license/CaffeinatedPinguin/ravi)](LICENSE)

**Status:** active, maintained by one person on a best-effort basis. Issues are welcome; outside
pull requests are not accepted. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Features

- **Dashboard:** connected repositories, local changes, pull requests waiting for your review, your
  own pull requests, and a review-later list.
- **Local review:** uncommitted, staged, unstaged, branch against base, and commit ranges. File tree,
  split or unified view, syntax highlighting, ignored whitespace, and expandable context.
- **Pull request review:** GitHub.com and GitLab.com, file threads, the conversation, review-later,
  and a three-dot diff like the forge's "Files changed" view.
- **Comments:** drafts, replies, edits, images, outdated markers, and Approve / Request changes.
- **Markdown v1:** Copy, Save, and Import one self-explaining file for AI agents.
- **Notifications:** a background poller with author and text filters, plus a filter preview.
- **Security:** a loopback-only server, session cookie, CSRF header, strict security headers, a
  server image proxy, and tokens that never reach the browser.
- **Performance:** virtualized diff rendering that stays smooth with thousands of changed files.

## Install

ravi needs Node 22.20 or newer and git.

Download the installer for your system from the
[latest release](https://github.com/CaffeinatedPinguin/ravi/releases/latest). You do not need the
other files on that page.

### Windows

Download `install-windows.ps1`, open PowerShell in the folder where the file landed, and run:

```powershell
powershell -ExecutionPolicy Bypass -File .\install-windows.ps1
```

Windows blocks downloaded scripts by default, which is why the command passes
`-ExecutionPolicy Bypass`. Run it from a PowerShell window so you can see the output.

### macOS

Download `install-macos.sh`, open Terminal in the download folder, and run:

```sh
sh install-macos.sh
```

### Linux

Download `install-linux.sh`, open a terminal in the download folder, and run:

```sh
sh install-linux.sh
```

The installers are plain scripts; read one before you run it. Each checks for Node and git,
downloads `ravi.mjs` from the latest release, writes a launcher, and adds it to your `PATH`. They
need no administrator rights, and they contact only `api.github.com` and `github.com`.

Each installer uses the standard per-user locations:

| System | Program and launcher | `PATH` change |
|---|---|---|
| Windows | `%LOCALAPPDATA%\Programs\ravi` (`ravi.mjs`, `ravi.cmd`) | your user `PATH` |
| macOS | `~/.local/share/ravi/ravi.mjs`, `~/.local/bin/ravi` | two lines in `~/.zshrc` (`~/.bash_profile` for bash) |
| Linux | `~/.local/share/ravi/ravi.mjs`, `~/.local/bin/ravi` | two lines in `~/.bashrc` (`~/.zshrc` for zsh), only if `~/.local/bin` is not in `PATH` yet |

Without a network connection, download `ravi.mjs` from the release as well and pass it to the
installer: `-LocalFile .\ravi.mjs` on Windows, `sh install-linux.sh ./ravi.mjs` on Linux and macOS.
Set `RAVI_PREFIX` (macOS and Linux) or pass `-InstallDir` (Windows) to install somewhere else.

## Start ravi

Open a new terminal. Terminals that were already open do not see the `PATH` change. Go to a folder
with a git repository and run:

```sh
ravi                          # open the repository in the current folder
ravi path/to/repo             # open another repository
ravi --help                   # all options
```

ravi opens the review in your browser and keeps running in that terminal. Press `Ctrl+C` to stop it.
Running `ravi` again while it is running only opens the browser. On the first run, the dashboard
asks you to add a repository: choose a local folder or paste a GitHub/GitLab URL. Application data,
including the token file, lives in `~/.ravi`.

## Update and uninstall

To update, run the installer again. It compares your version with the latest release and downloads
only when there is a newer one.

To uninstall, delete the folder or files listed in the table above and remove the `PATH` entry (the
installer prints the exact steps at the end). Your reviews and tokens stay in `~/.ravi` until you
delete that folder too.

## Built with

TypeScript, Node, React, Vite, Shiki, markdown-it, Zod, Playwright in Microsoft Edge, and Vitest.

## Documentation

Architecture, the forge layer, and the review Markdown format are in [docs/index.md](docs/index.md).

## Development

```sh
pnpm install
pnpm dev            # API on :4784, UI with hot reload on http://localhost:5173
pnpm test           # Vitest
pnpm typecheck
pnpm lint
pnpm e2e            # Playwright in Microsoft Edge (build first)
pnpm bench          # server-side benchmark on a throwaway repository
pnpm build          # dist/ravi.mjs + the three installers (the release files)
```

CI runs on every pull request and on `main`; `ci-required` is the only required check. Dependabot
keeps the GitHub Actions and npm/pnpm dependencies up to date.

## Security

ravi runs locally and holds forge tokens, so the server binds `127.0.0.1`, checks the `Host` header,
requires a session cookie, adds a CSRF header to mutating calls, passes git arguments as an array,
and keeps tokens in `~/.ravi/.env` only. To report a vulnerability, follow [SECURITY.md](SECURITY.md).

## License

Copyright (C) 2026 smrodek.xyz. Licensed under the GNU Affero General Public License v3.0 only; see
[LICENSE](LICENSE).

## Open-source packages

ravi builds on React, Vite, Shiki, markdown-it, Zod, and TanStack Virtual. Direct dependencies are
listed in [package.json](package.json); `pnpm-lock.yaml` pins the full tree.
