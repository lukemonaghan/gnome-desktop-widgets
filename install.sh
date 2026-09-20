#!/usr/bin/env bash
set -euo pipefail

# install.sh — install this GNOME Shell extension locally (or system-wide)
# Usage: ./install.sh [--enable|-e] [--system|-s]

usage() {
  cat <<EOF
Usage: $0 [--enable|-e] [--system|-s] [--help|-h]

Options:
  --enable, -e    Enable the extension after copying (uses gnome-extensions)
  --system, -s    Install system-wide (/usr/share/gnome-shell/extensions) — requires root
  --help, -h      Show this help
EOF
}

ENABLE=no
SYSTEM=no
while [ $# -gt 0 ]; do
  case "$1" in
    -e|--enable) ENABLE=yes; shift ;;
    -s|--system) SYSTEM=yes; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown arg: $1"; usage; exit 1 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
META="$SCRIPT_DIR/metadata.json"
[ -f "$META" ] || { echo "metadata.json not found in $SCRIPT_DIR"; exit 1; }

# parse uuid from metadata.json (robust, no jq required)
UUID=$(sed -n 's/.*"uuid"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$META" | head -n1)
[ -n "$UUID" ] || { echo "Failed to parse uuid from metadata.json"; exit 1; }

if [ "$SYSTEM" = "yes" ]; then
  DEST="/usr/share/gnome-shell/extensions/$UUID"
else
  DEST="$HOME/.local/share/gnome-shell/extensions/$UUID"
fi

echo "Installing extension '$UUID' → $DEST"

if [ "$SYSTEM" = "yes" ] && [ "$(id -u)" -ne 0 ]; then
  echo "System install requires root — re-running with sudo..."
  exec sudo "$0" "$@"
fi

mkdir -p "$DEST"
rsync -a --delete --exclude '.git' --exclude 'node_modules' "$SCRIPT_DIR"/ "$DEST"/

# try to ensure local ownership is the user (best-effort)
if [ "$SYSTEM" != "yes" ]; then
  chown -R "$(id -u):$(id -g)" "$DEST" 2>/dev/null || true
fi

echo "Files copied."

# Widget scripts are hot reloadable: the shell watches each installed widget
# folder. Refresh the installed copies directly so edits show up immediately
# instead of waiting for a DEFAULTS_VERSION bump. (Changes to the extension's
# own modules still need a logout on Wayland.)
if [ "$SYSTEM" != "yes" ]; then
  LIB="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-desktop-widgets/default-library/widgets"
  for dir in "$SCRIPT_DIR"/default-widgets/*/; do
    id=$(sed -n 's/.*"id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$dir/metadata.json" | head -n1)
    if [ -n "$id" ] && [ -d "$LIB/$id" ] && ! cmp -s "$dir/index.js" "$LIB/$id/widget.js"; then
      cp "$dir/index.js" "$LIB/$id/widget.js"
      echo "Hot-reloaded widget script: $id"
    fi
  done
fi

# Compile GSettings schemas if present
if [ -d "$DEST/schemas" ]; then
  echo "Compiling GSettings schemas..."
  glib-compile-schemas "$DEST/schemas/" || echo "Warning: schema compilation failed"
fi

if [ "$ENABLE" = "yes" ]; then
  if command -v gnome-extensions >/dev/null 2>&1; then
    echo "Enabling $UUID..."
    gnome-extensions disable "$UUID" 2>/dev/null || true
    gnome-extensions enable "$UUID" || echo "gnome-extensions returned non-zero"
  else
    echo "gnome-extensions CLI not available; enable manually with: gnome-extensions enable $UUID"
  fi
fi

case "${XDG_SESSION_TYPE:-}" in
  wayland) echo "Wayland session: log out and back in to apply changes." ;;
  x11) echo "X11 session: press Alt+F2, type 'r' and press Enter to reload GNOME Shell." ;;
  *) echo "To apply changes you may need to restart GNOME Shell or log out/in." ;;
esac

echo "Done."
