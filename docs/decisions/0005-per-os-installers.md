# 0005 — One installer per operating system

- Status: accepted
- Date: 2026-11-17
- Superseded-by: none
- Refines: the distribution part of [0001](0001-stack-and-distribution.md) (launchers and installing)

## Context

The first release offered `ravi.mjs`, `ravi` and `ravi.cmd` side by side, and nothing said which
files a given system needed. The installers lived only in the repository: they needed a folder with
the release files already in it, put everything in `~/.ravi/bin` (an unusual place, especially on
Windows), did not change `PATH`, and left the user guessing how to start ravi again.

The installers are read by the people who run them, so being easy to follow matters more than
being clever.

## Decision

- The release contains `ravi.mjs` and one installer per system: `install-windows.ps1`,
  `install-macos.sh` and `install-linux.sh`. A user downloads the installer for their system and
  runs it. The launchers are no longer release files; each installer writes its own.
- An installer downloads `ravi.mjs` from the GitHub release of the latest tag, never from `main`
  (which may hold unreleased code). It finds the tag through the Releases API, says whether the
  installed version is already current, and prints every address it contacts. A local `ravi.mjs`
  can be given instead, which needs no network at all.
- Each installer is a short script with the same seven numbered steps (requirements, installed
  version, latest version, download, launcher, `PATH`, summary), commented in English. The macOS and
  Linux scripts are deliberately near copies: a reader sees one system's logic, without OS branches.
- Everything is per user and needs no administrator rights or `sudo`. These are the default
  folders, the standard per-user places on each system:

  ```text
  Windows        %LOCALAPPDATA%\Programs\ravi   (ravi.mjs and ravi.cmd together)
  macOS, Linux   ~/.local/share/ravi/ravi.mjs   (the program)
                 ~/.local/bin/ravi              (the launcher)
  ```

  `PATH` is changed explicitly: the user `PATH` on Windows, one marked line in the shell profile
  on macOS and Linux, added only once.
- Data lives next to the program, so everything is in one place. The launcher each installer
  writes sets `RAVI_HOME` to the install folder (a `RAVI_HOME` already in the environment wins).
  Started without the launcher, ravi still defaults to `~/.ravi`. The `.env` token file keeps the
  rules of [0004](0004-tokens-written-from-settings.md). Installers never move existing data, since
  it holds tokens: if `~/.ravi` exists, they print the command to copy it.
- Installers never install Node.js or git; they report what is missing.

## Consequences

- One obvious file per system, and the same steps to update (run it again) and to uninstall (delete
  the printed folders and `PATH` entry). Uninstalling also deletes the data, so the installers say
  to copy it out first.
- The build (`scripts/finish-build.ts`) copies the installers into `dist/`, so `dist/` is exactly
  the release; the release workflow lists those four files.
- Shell installers are run as `sh install-linux.sh`, because the artifact transfer drops the
  executable bit. On Windows the command passes `-ExecutionPolicy Bypass`, because downloaded
  scripts are blocked by default.
- An installer always installs the latest release, whichever release it was attached to.
- Downloads rely on HTTPS to GitHub; there is no separate checksum or signature yet.
- Three scripts must be kept in step by hand when the steps change.

## Links

- `install/`
- `scripts/finish-build.ts`
- `.github/workflows/ci.yml`
