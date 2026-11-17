<p align="center"><img src="src/ui/public/brand/logo.svg" width="96" alt="ravi logo"></p>

# ravi

ravi is a local code review tool with a GitHub/GitLab-like UI. It reviews local git changes and
GitHub.com/GitLab.com pull requests, keeps comments as drafts until you press **Send**, and ships as
one JavaScript file that runs on Node with the UI embedded.

## Features

- **Dashboard** — connected repositories, local changes, pull requests waiting for your review, your
  own pull requests and a review-later list.
- **Local review** — uncommitted, staged, unstaged, branch against base and commit ranges; a file
  tree, split or unified view, syntax highlighting, ignore whitespace and expandable context.
- **Pull request review** — GitHub.com and GitLab.com, file threads, the conversation, review-later
  and a three-dot diff like the forge's "Files changed" view.
- **Comments** — drafts, replies, edits, images, outdated markers and Approve / Request changes.
- **Markdown v1** — Copy, Save and Import one self-explaining file for AI agents.
- **Notifications** — a background poller with author and text filters and a filter preview.
- **Security** — a loopback-only server, session cookie, CSRF header, strict security headers, a
  server image proxy, and tokens that never reach the browser.
- **Performance** — virtualized diff rendering that stays smooth with thousands of changed files.

## Install

ravi needs Node 22.20 or newer and git. Download the installer for your system from the
[latest release](https://github.com/CaffeinatedPinguin/ravi/releases/latest) and run it. You do not
need the other files on that page.

| System | Download | Run |
|---|---|---|
| Windows | `install-windows.ps1` | `powershell -ExecutionPolicy Bypass -File .\install-windows.ps1` |
| macOS | `install-macos.sh` | `sh install-macos.sh` |
| Linux | `install-linux.sh` | `sh install-linux.sh` |

On Windows, run the command from a PowerShell window so the output stays visible. Windows blocks
downloaded scripts by default, which is why the command passes `-ExecutionPolicy Bypass`.

The installers are short, plain scripts written to be read: every step has a comment, so open one
before you run it. In short, an installer:

1. checks that Node.js and git are installed (it never installs them for you);
2. asks GitHub for the latest ravi release and says whether you already have it;
3. downloads `ravi.mjs` from that release and writes a small `ravi` launcher next to it;
4. adds the launcher's folder to your `PATH`, so `ravi` works in any new terminal;
5. prints how to start, update and uninstall ravi.

It needs no administrator rights or `sudo`, and it prints every address it contacts, which are
only `api.github.com` (latest release) and `github.com` (the `ravi.mjs` download).

| System | Program and data | Launcher | `PATH` change |
|---|---|---|---|
| Windows | `%LOCALAPPDATA%\Programs\ravi` | `ravi.cmd`, same folder | your user `PATH` |
| macOS | `~/.local/share/ravi` | `~/.local/bin/ravi` | two lines in `~/.zshrc` (`~/.bash_profile` for bash) |
| Linux | `~/.local/share/ravi` | `~/.local/bin/ravi` | two lines in `~/.bashrc` (`~/.zshrc` for zsh), only if `~/.local/bin` is not in `PATH` yet |

ravi keeps its data (reviews, settings and the `.env` file with your tokens) in the same folder as
the program, so everything is in one place. The launcher sets `RAVI_HOME` to that folder; run
`ravi --help` to see it. If you used an earlier release, which kept its data in `~/.ravi`, the
installer shows the command to copy it over.

Without a network connection, download `ravi.mjs` from the release as well and pass it to the
installer: `-LocalFile .\ravi.mjs` on Windows, `sh install-linux.sh ./ravi.mjs` on Linux and macOS.
Set `RAVI_PREFIX` (macOS and Linux) or pass `-InstallDir` (Windows) to install somewhere else.

## Start ravi

Open a **new** terminal (windows that were already open do not see the `PATH` change), go to a
folder with a git repository and run:

```sh
ravi                          # open the repository in the current folder
ravi path/to/repo             # open another repository
ravi --help                   # all options
```

ravi opens the review in your browser and keeps running in that terminal; press `Ctrl+C` to stop
it. Running `ravi` again while it is running only opens the browser. On first run ravi opens the
dashboard and asks you to add a repository: choose a local folder or paste a GitHub/GitLab URL.
Application data, including the token file, lives in the install folder (see the table above).

## Update and uninstall

To update, run the installer again: it compares your version with the latest release and downloads
only when there is a newer one.

To uninstall, delete the program folder and the launcher listed in the table above and remove the
`PATH` entry (the installer prints the exact steps at the end). The folder also holds your reviews and
tokens, so copy them out first if you want to keep them.

## Built with

TypeScript, Node, React, Vite, shiki, markdown-it, Zod, Playwright in Microsoft Edge and Vitest.

## Documentation

Architecture, the forge layer and the review Markdown format are in
[docs/index.md](docs/index.md).

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

CI runs on every pull request and on `main`, and the single required check is `ci-required`.
Dependabot keeps the GitHub Actions and npm/pnpm dependencies up to date. Report bugs and feature
requests through the issue forms; pull requests from outside contributors are not accepted (only
collaborators can open them), see [CONTRIBUTING.md](CONTRIBUTING.md).

## Security

ravi runs locally and holds forge tokens, so it is built security-first: the server binds
`127.0.0.1`, checks the `Host` header, requires a session cookie, adds a CSRF header to mutating
calls, passes git arguments as an array, and keeps tokens in the `.env` file of its data folder only. To report a
vulnerability, follow [SECURITY.md](SECURITY.md).

## License

Copyright (C) 2026 smrodek.xyz. Licensed under the GNU Affero General Public License v3.0 only; see
[LICENSE](LICENSE).

## Author

Made by [smrodek.xyz](https://smrodek.xyz).

## Open-source packages

| Package | Purpose | Repository |
|---|---|---|
| `@tanstack/react-virtual` | Virtualized lists for large diffs | [TanStack/virtual](https://github.com/TanStack/virtual) |
| `markdown-it` | Markdown rendering for comments and review files | [markdown-it/markdown-it](https://github.com/markdown-it/markdown-it) |
| `react` | UI library | [react/react](https://github.com/react/react) |
| `react-dom` | DOM renderer for React | [react/react](https://github.com/react/react) |
| `shiki` | Syntax highlighting | [shikijs/shiki](https://github.com/shikijs/shiki) |
| `zod` | Schema validation for the API contract | [colinhacks/zod](https://github.com/colinhacks/zod) |
| `@playwright/test` | Browser end-to-end tests in Edge | [microsoft/playwright](https://github.com/microsoft/playwright) |
| `@types/markdown-it` | TypeScript types for markdown-it | [DefinitelyTyped](https://github.com/DefinitelyTyped/DefinitelyTyped) |
| `@types/node` | TypeScript types for Node | [DefinitelyTyped](https://github.com/DefinitelyTyped/DefinitelyTyped) |
| `@types/react` | TypeScript types for React | [DefinitelyTyped](https://github.com/DefinitelyTyped/DefinitelyTyped) |
| `@types/react-dom` | TypeScript types for React DOM | [DefinitelyTyped](https://github.com/DefinitelyTyped/DefinitelyTyped) |
| `@vitejs/plugin-react` | Vite plugin for React | [vitejs/vite-plugin-react](https://github.com/vitejs/vite-plugin-react) |
| `eslint` | JavaScript and TypeScript linter | [eslint/eslint](https://github.com/eslint/eslint) |
| `eslint-plugin-react-hooks` | ESLint rules for React Hooks | [facebook/react](https://github.com/facebook/react) |
| `typescript` | Type checker and compiler | [microsoft/TypeScript](https://github.com/microsoft/TypeScript) |
| `typescript-eslint` | TypeScript support for ESLint | [typescript-eslint/typescript-eslint](https://github.com/typescript-eslint/typescript-eslint) |
| `vite` | Dev server and bundler | [vitejs/vite](https://github.com/vitejs/vite) |
| `vitest` | Unit test runner | [vitest-dev/vitest](https://github.com/vitest-dev/vitest) |
