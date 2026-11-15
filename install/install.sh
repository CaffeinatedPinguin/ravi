#!/bin/sh
# Installs ravi into ~/.ravi/bin from a folder that holds ravi.mjs and the launchers
# (a release archive or ./dist after `pnpm build`). Usage: install.sh [source-folder]
set -eu

SOURCE="${1:-$(dirname "$0")/../dist}"
TARGET="$HOME/.ravi/bin"

if [ ! -f "$SOURCE/ravi.mjs" ]; then
  echo "ravi.mjs not found in $SOURCE" >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22 or newer is required" >&2
  exit 1
fi

mkdir -p "$TARGET"
cp "$SOURCE/ravi.mjs" "$SOURCE/ravi" "$TARGET/"
chmod +x "$TARGET/ravi"

echo "Installed to $TARGET"
case ":$PATH:" in
  *":$TARGET:"*) ;;
  *) echo "Add it to your PATH:  export PATH=\"$TARGET:\$PATH\"" ;;
esac
