# revu

Local code review with a GitHub/GitLab-like UI.

- Review local git changes before you commit or push.
- Review GitHub.com and GitLab.com pull requests; comments stay drafts until you press Send.
- Exchange comments with AI agents as one self-explaining Markdown file.
- One JavaScript file, no `node_modules`. Needs Node 22 or newer and git.

> Work in progress. See `docs/specs/SPEC.md` for scope and status.

## Install

Copy the three files from a release (`revu.mjs`, `revu`, `revu.cmd`) into one folder on your `PATH`,
or run the installer, which puts them in `~/.revu/bin`:

```sh
./install/install.sh        # Linux, macOS
```

```powershell
./install/install.ps1       # Windows
```

## Use

```sh
revu                # open the repository in the current folder
revu path/to/repo   # open another folder
revu --help
```

Forge tokens go into `~/.revu/.env` (revu never writes this file):

```
GITHUB_TOKEN=...
GITLAB_TOKEN=...
```

## Develop

```sh
pnpm install
pnpm dev            # API on :4784, UI with hot reload on http://localhost:5173
pnpm test && pnpm typecheck && pnpm lint
pnpm build          # dist/revu.mjs + launchers
```

Architecture and decisions: `docs/index.md`. Rules for AI agents: `AGENTS.md`.

## License

MIT
