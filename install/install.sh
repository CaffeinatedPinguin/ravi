#!/bin/sh
# Installs revu into ~/.revu/bin from a folder that holds revu.mjs and the launchers
# (a release archive or ./dist after `pnpm build`). Usage: install.sh [source-folder]
set -eu

SOURCE="${1:-$(dirname "$0")/../dist}"
TARGET="$HOME/.revu/bin"

if [ ! -f "$SOURCE/revu.mjs" ]; then
  echo "revu.mjs not found in $SOURCE" >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22 or newer is required" >&2
  exit 1
fi

mkdir -p "$TARGET"
cp "$SOURCE/revu.mjs" "$SOURCE/revu" "$TARGET/"
chmod +x "$TARGET/revu"

echo "Installed to $TARGET"
case ":$PATH:" in
  *":$TARGET:"*) ;;
  *) echo "Add it to your PATH:  export PATH=\"$TARGET:\$PATH\"" ;;
esac
