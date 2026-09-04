#!/usr/bin/env bash
#
# Fetch the ffmpeg that ships with Dialect.
#
# Which build is shipped has consequences beyond the binary. ffmpeg is LGPL, and
# GPL when built with certain components, and shipping a GPL build alongside
# Dialect changes what Dialect itself may be licensed as. So the source is named
# here, in a file someone reviews, rather than fetched as "whatever is newest"
# from a line buried in a workflow.
#
# Windows is settled: BtbN publish an LGPL build and it is used.
#
# macOS is not, and this script does not pretend otherwise. The builds that are
# easy to fetch for macOS are GPL, and the one long-standing publisher of them
# is Intel-only, which is no use on Apple Silicon. Rather than quietly ship the
# wrong licence on one platform out of three, macOS ships nothing and the app
# falls back to whatever is on PATH — exactly as it did before. That is a
# decision for whoever owns this project to make, and it is written down here so
# that it is made rather than defaulted into.
#
# Run from the repository root. Writes into apps/desktop/src-tauri/binaries.

set -euo pipefail

DEST="apps/desktop/src-tauri/binaries"
mkdir -p "$DEST"

# LGPL, from BtbN. The `latest` tag moves, but the versioned asset name pins the
# release line — n8.1 stays n8.1. Changing this URL means checking the licence
# of what it points at again.
WIN_URL="https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n8.1-latest-win64-lgpl-8.1.zip"

say() { printf '  %s\n' "$*"; }

case "${1:-}" in
  windows)
    tmp=$(mktemp -d)
    say "fetching the LGPL build"
    curl -fsSL --retry 3 -o "$tmp/ffmpeg.zip" "$WIN_URL"
    unzip -q "$tmp/ffmpeg.zip" -d "$tmp"

    # The archive nests everything under a directory whose name carries the
    # build date, so the binaries are found rather than assumed.
    find "$tmp" -name 'ffmpeg.exe' -exec cp {} "$DEST/" \;
    find "$tmp" -name 'ffprobe.exe' -exec cp {} "$DEST/" \;
    # Its licence travels with it. That is not a nicety, it is the condition.
    find "$tmp" -name 'LICENSE*' -exec cp {} "$DEST/LICENSE-ffmpeg.txt" \; 2>/dev/null || true
    rm -rf "$tmp"
    ;;

  macos-x64 | macos-arm64)
    say "no verified LGPL build is fetched for macOS — see the note at the top"
    say "of this script. The app will use ffmpeg from PATH, as it always has."
    exit 0
    ;;

  *)
    echo "usage: $0 <windows|macos-x64|macos-arm64>" >&2
    exit 2
    ;;
esac

# Prove they run before a release is built around them. A binary that is present
# and will not start is worse than one that is missing: the missing one falls
# back to PATH, and this one does not.
for tool in ffmpeg ffprobe; do
  bin="$DEST/$tool"
  [ -f "$bin.exe" ] && bin="$bin.exe"
  if [ ! -f "$bin" ]; then
    echo "  $tool did not arrive" >&2
    exit 1
  fi
  "$bin" -version | head -1 | sed 's/^/  /'
done

say "in $DEST:"
ls -l "$DEST" | sed 's/^/    /'
