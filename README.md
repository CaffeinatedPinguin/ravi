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

## Install and run

ravi needs Node 22.20 or newer and git.

Download a release and copy `ravi.mjs`, `ravi` and `ravi.cmd` into one folder on your `PATH`, or run
the installer, which installs ravi into `~/.ravi/bin`:

```sh
./install/install.sh          # Linux, macOS
```

```powershell
./install/install.ps1         # Windows
```

```sh
ravi --help                   # options
ravi                          # open the repository in the current folder
```

On first run ravi opens the dashboard and asks you to add a repository: choose a local folder or
paste a GitHub/GitLab URL. Application data, including the token file, lives in `~/.ravi`.

## Built with

TypeScript, Node, React, Vite, shiki, markdown-it, Zod, Playwright in Microsoft Edge and Vitest.

## Development

```sh
pnpm install
pnpm dev            # API on :4784, UI with hot reload on http://localhost:5173
pnpm test           # Vitest
pnpm typecheck
pnpm lint
pnpm e2e            # Playwright in Microsoft Edge (build first)
pnpm bench          # server-side benchmark on a throwaway repository
pnpm build          # dist/ravi.mjs + ravi and ravi.cmd launchers
```

## Security

ravi runs locally and holds forge tokens, so it is built security-first: the server binds
`127.0.0.1`, checks the `Host` header, requires a session cookie, adds a CSRF header to mutating
calls, passes git arguments as an array, and keeps tokens in `~/.ravi/.env` only. To report a
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
