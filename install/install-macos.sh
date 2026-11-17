#!/bin/sh
# ravi installer for macOS.
#
# ravi is a local code review tool. This script installs it for the current user.
#
# What this script does, in order:
#   1. Checks that Node.js 22.20+, git and curl are installed.
#   2. Looks for an existing ravi installation and reads its version.
#   3. Asks GitHub which ravi release is the latest one.
#   4. Downloads ravi.mjs from that release and puts it in the install folder.
#   5. Writes a small launcher, "ravi", that runs it with Node.js. The launcher makes ravi keep
#      its data (reviews, tokens, settings) in the same folder, so everything is in one place.
#   6. Makes sure the launcher's folder is in your PATH, so `ravi` works in a terminal.
#   7. Prints how to start, update and uninstall ravi.
#
# What this script does NOT do:
#   - It does not use sudo and never touches anything outside your home folder.
#   - It writes two files (ravi.mjs and the launcher) and, only if needed, two lines to
#     your shell profile. macOS does not have ~/.local/bin in PATH by default, so step 6
#     normally adds it. Running it again to update never touches your data.
#
# Network access (nothing else is contacted, nothing about you is sent):
#   - https://api.github.com/repos/CaffeinatedPinguin/ravi/releases/latest          (step 3)
#   - https://github.com/CaffeinatedPinguin/ravi/releases/download/<tag>/ravi.mjs   (step 4)
# Give the path of an already downloaded ravi.mjs as the first argument to install that file
# without any network access.
#
# Usage:
#   sh install-macos.sh                 # download and install the latest release
#   sh install-macos.sh ./ravi.mjs      # install a ravi.mjs you already have (offline)
#
# Default folders (change them by setting RAVI_PREFIX, for example RAVI_PREFIX=/opt/ravi):
#   ~/.local/share/ravi/ravi.mjs        the program (your data lives in this folder too)
#   ~/.local/bin/ravi                   the launcher
#
# This file is plain POSIX sh, so it runs under the old bash 3.2 and under zsh that macOS ships.

# Stop at the first error (-e) and on use of an unset variable (-u), instead of carrying on
# with a half-finished installation.
set -eu

# --- Settings ---------------------------------------------------------------------------------

REPO="CaffeinatedPinguin/ravi"
LATEST_RELEASE_URL="https://api.github.com/repos/$REPO/releases/latest"
MIN_NODE_MAJOR=22   # together with MIN_NODE_MINOR: must match "engines" in package.json
MIN_NODE_MINOR=20
TOTAL_STEPS=7

PREFIX="${RAVI_PREFIX:-$HOME/.local}"
APP_DIR="$PREFIX/share/ravi"
BIN_DIR="$PREFIX/bin"
APP_FILE="$APP_DIR/ravi.mjs"     # the program itself
LAUNCHER="$BIN_DIR/ravi"         # lets you type `ravi` in a terminal

# Optional first argument: a ravi.mjs to install instead of downloading one.
LOCAL_FILE="${1:-}"

# --- Helpers ----------------------------------------------------------------------------------

# Prints a numbered heading so you can follow what the script is doing.
step() {
  printf '\n[%s/%s] %s\n' "$1" "$TOTAL_STEPS" "$2"
}

# Prints one indented line of detail below a step heading.
say() {
  printf '  %s\n' "$1"
}

# Prints an error and stops the script.
fail() {
  printf '\nERROR: %s\n' "$1" >&2
  exit 1
}

# --- Is this the right installer? -------------------------------------------------------------

if [ "$(uname -s)" != "Darwin" ]; then
  fail "This installer is for macOS, but this system is $(uname -s).
  Linux:   install-linux.sh
  Windows: install-windows.ps1"
fi

echo "ravi installer for macOS"
echo "Install folder: $APP_DIR"

# --- Step 1: requirements ---------------------------------------------------------------------
# ravi runs on Node.js and uses the git program to read your repositories. curl downloads the
# release. This script does not install any of them; it only tells you what is missing.

step 1 "Checking requirements (Node.js, git, curl)"
missing=0

if ! command -v node >/dev/null 2>&1; then
  say "MISSING: Node.js. Install version $MIN_NODE_MAJOR or newer: https://nodejs.org (or: brew install node)"
  missing=1
else
  node_version=$(node --version)          # for example "v22.20.0"
  numbers=${node_version#v}               # "22.20.0"
  major=${numbers%%.*}                    # "22"
  after_major=${numbers#*.}               # "20.0"
  minor=${after_major%%.*}                # "20"
  if [ "$major" -gt "$MIN_NODE_MAJOR" ] ||
     { [ "$major" -eq "$MIN_NODE_MAJOR" ] && [ "$minor" -ge "$MIN_NODE_MINOR" ]; }; then
    say "Node.js $node_version - ok"
  else
    say "MISSING: Node.js $node_version is too old. Install $MIN_NODE_MAJOR.$MIN_NODE_MINOR or newer: https://nodejs.org"
    missing=1
  fi
fi

# On a Mac without developer tools, /usr/bin/git exists but is only a stub that offers to
# install them. So we run it instead of just looking for it.
if ! git --version >/dev/null 2>&1; then
  say "MISSING: git. Install the Apple developer tools with: xcode-select --install"
  missing=1
else
  say "$(git --version) - ok"
fi

# curl is only needed when we download; installing a local file needs no network tool.
if [ -z "$LOCAL_FILE" ]; then
  if ! command -v curl >/dev/null 2>&1; then
    say "MISSING: curl. It ships with macOS, so something is wrong with your PATH."
    missing=1
  else
    say "curl - ok"
  fi
fi

if [ "$missing" -eq 1 ]; then
  fail "Install the missing programs listed above, then run this installer again."
fi

# --- Step 2: is ravi already installed? -------------------------------------------------------

step 2 "Looking for an existing installation"
installed_version=""
if [ -f "$APP_FILE" ]; then
  installed_version=$(node "$APP_FILE" --version 2>/dev/null || true)
fi
if [ -n "$installed_version" ]; then
  say "Found ravi $installed_version in $APP_DIR"
else
  say "ravi is not installed yet"
fi

# --- Steps 3 and 4: get ravi.mjs --------------------------------------------------------------
# The new program is first saved as ravi.new.mjs and only then moved over ravi.mjs, so an
# interrupted download can never leave you with a broken installation.

mkdir -p "$APP_DIR" "$BIN_DIR"
new_file="$APP_DIR/ravi.new.mjs"
have_new_file=no

if [ -n "$LOCAL_FILE" ]; then
  # Offline mode: nothing is downloaded, the file you gave is used as it is.
  step 3 "Skipped: using a local file, so GitHub is not contacted"
  [ -f "$LOCAL_FILE" ] || fail "File not found: $LOCAL_FILE"
  step 4 "Installing $LOCAL_FILE"
  cp "$LOCAL_FILE" "$new_file"
  have_new_file=yes
else
  step 3 "Checking GitHub for the latest release"
  say "Asking: $LATEST_RELEASE_URL"
  # -f fails on HTTP errors, -s hides the progress meter, -S still shows errors, -L follows
  # redirects. GitHub requires a User-Agent header; any name works.
  response=$(curl -fsSL -H 'User-Agent: ravi-installer' "$LATEST_RELEASE_URL") ||
    fail "Could not reach GitHub.
  You can download ravi.mjs by hand from https://github.com/$REPO/releases/latest
  and install it without a network connection with:
    sh install-macos.sh ./ravi.mjs"

  # The answer is JSON; pick out the line  "tag_name": "v0.1.0",
  tag=$(printf '%s\n' "$response" | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n 1)
  [ -n "$tag" ] || fail "GitHub answered, but without a release tag. Try again later."
  latest_version=${tag#v}                 # "v0.1.0" -> "0.1.0"
  say "Latest release: $latest_version"

  if [ "$installed_version" = "$latest_version" ]; then
    say "You already have the latest version ($installed_version)."
    step 4 "Skipped: nothing to download"
  else
    download_url="https://github.com/$REPO/releases/download/$tag/ravi.mjs"
    step 4 "Downloading ravi $latest_version"
    say "From: $download_url"
    curl -fL -# -o "$new_file" "$download_url" || {
      rm -f "$new_file"
      fail "The download failed. Nothing was changed."
    }
    have_new_file=yes
  fi
fi

# Install the new file, if there is one: first prove that it runs, then replace the old one.
if [ "$have_new_file" = yes ]; then
  new_version=$(node "$new_file" --version 2>/dev/null) || {
    rm -f "$new_file"
    fail "The file did not run with Node.js, so it was not installed. The old installation (if any) is untouched."
  }
  mv -f "$new_file" "$APP_FILE"
  say "Installed ravi $new_version to $APP_FILE"
fi

# --- Step 5: the launcher ----------------------------------------------------------------------
# The launcher is a short script: it runs ravi.mjs with Node.js and passes your arguments on.
# The full path of ravi.mjs is written into it now, so there is nothing to guess later.
# It also sets RAVI_HOME to the program folder, which is how ravi learns where to keep its data
# (reviews, tokens, settings); without it ravi would use ~/.ravi. If RAVI_HOME is already set in
# your environment, that value wins.

step 5 "Writing the launcher"
cat > "$LAUNCHER" <<EOF
#!/bin/sh
# Written by the ravi installer. Runs ravi with Node.js and keeps its data next to the program.
export RAVI_HOME="\${RAVI_HOME:-$APP_DIR}"
exec node "$APP_FILE" "\$@"
EOF
chmod +x "$LAUNCHER"
say "Wrote $LAUNCHER"

# --- Step 6: PATH ------------------------------------------------------------------------------
# The shell finds commands through the folders listed in PATH. If the launcher's folder is not
# there yet, we add one line to your shell profile, which is read whenever you open a terminal.

step 6 "Making sure $BIN_DIR is in your PATH"
path_line="export PATH=\"$BIN_DIR:\$PATH\""
profile_changed=no

case ":$PATH:" in
  *":$BIN_DIR:"*)
    say "Already in PATH - nothing to change"
    ;;
  *)
    # Use the profile of your login shell. macOS uses zsh by default (~/.zshrc); for bash,
    # Terminal starts a login shell, which reads ~/.bash_profile.
    case "${SHELL:-}" in
      */bash) profile="$HOME/.bash_profile" ;;
      *)      profile="$HOME/.zshrc" ;;
    esac

    # Append the line only once, so running the installer again does not repeat it.
    if [ -f "$profile" ] && grep -Fxq "$path_line" "$profile"; then
      say "$profile already contains the PATH line - nothing to change"
    else
      say "Adding these two lines to $profile:"
      say "  # Added by the ravi installer"
      say "  $path_line"
      printf '\n# Added by the ravi installer\n%s\n' "$path_line" >> "$profile"
      profile_changed=yes
    fi
    ;;
esac

# --- Step 7: summary ---------------------------------------------------------------------------
# Run the launcher by its full path (this terminal's PATH is not refreshed yet) to prove that
# the whole chain works: launcher -> Node.js -> ravi.mjs.

step 7 "Checking the installation"
say "ravi $("$LAUNCHER" --version) is installed"

# Earlier releases kept their data in ~/.ravi. We never move your data for you (it holds your
# tokens); if there is something to bring along, we show the command to do it.
if [ -d "$HOME/.ravi" ] && [ ! -d "$APP_DIR/data" ]; then
  echo
  say "Found data from an earlier setup in $HOME/.ravi"
  say "ravi now keeps its data in $APP_DIR. To bring your reviews and tokens"
  say "along, run this once (the old folder is left as it is):"
  say "  cp -R \"$HOME/.ravi/.\" \"$APP_DIR/\""
fi

echo
echo "----------------------------------------------------------------------"
echo "How to start ravi"
if [ "$profile_changed" = yes ]; then
  echo "  1. Open a NEW terminal, or run this in the current one:"
  echo "       $path_line"
else
  echo "  1. Open a terminal."
fi
echo "  2. Go to a folder with a git repository and run:"
echo "       ravi"
echo "     It opens the review in your browser. Press Ctrl+C in the terminal to stop it."
echo "  3. Other options:  ravi --help"
echo
echo "How to update"
echo "  Run this installer again. It tells you whether a newer version exists."
echo
echo "How to uninstall"
echo "  1. Delete the program, its data and the launcher:  rm -r \"$APP_DIR\" \"$LAUNCHER\""
echo "     The folder also holds your reviews and tokens, so copy them out first if you want them."
echo "  2. Remove the two lines marked \"Added by the ravi installer\" from your shell profile."
echo "----------------------------------------------------------------------"
