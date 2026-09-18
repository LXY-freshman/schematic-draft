#!/usr/bin/env bash
# Build the Windows desktop app from WSL and lay the deliverables out on the
# Windows side of the machine.
#
#   scripts/sync-to-windows.sh [target-dir]
#
# target-dir defaults to /mnt/d/AI/Claude/schematic-draft. Afterwards it holds:
#
#   app/                          ready-to-run folder (schematic-draft.exe)
#   Schematic Draft-<v>-...exe    single-file portable build of the same app
#   source/                       the source tree (no node_modules, no dist)
#   README.md                     how to use, what is guaranteed, how to rebuild
#
# The NSIS installer target needs Wine on Linux, so it is not built here; run
# `pnpm --filter @icm/desktop exec electron-builder --win nsis` on a Windows
# host or a Linux box with Wine if an installer is wanted.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
target="${1:-/mnt/d/AI/Claude/schematic-draft}"

# Binaries hosted on GitHub are unreachable from some networks; the npmmirror
# mirrors carry byte-identical copies of the Electron runtime and the
# electron-builder tool bundles.
export ELECTRON_MIRROR="${ELECTRON_MIRROR:-https://npmmirror.com/mirrors/electron/}"
export ELECTRON_BUILDER_BINARIES_MIRROR="${ELECTRON_BUILDER_BINARIES_MIRROR:-https://npmmirror.com/mirrors/electron-builder-binaries/}"

cd "$root"

echo "== building packages"
pnpm build >/dev/null

echo "== building editor (desktop flavour)"
VITE_ICM_DESKTOP=enabled pnpm --filter @icm/editor build >/dev/null

echo "== building desktop shell"
node apps/desktop/scripts/make-icons.mjs
node apps/desktop/scripts/build.mjs

echo "== packaging (portable exe + unpacked folder)"
(cd apps/desktop && ./node_modules/.bin/electron-builder --win portable --x64 --publish never)

echo "== syncing to $target"
mkdir -p "$target"
rm -rf "$target/app" "$target/source"
cp -r output/desktop/win-unpacked "$target/app"
cp output/desktop/*-portable.exe "$target/"
cp apps/desktop/README.md "$target/README.md"

# Source snapshot: everything git tracks plus the uncommitted working tree,
# minus build products. `git ls-files` keeps it to what the repo owns.
mkdir -p "$target/source"
git ls-files -z --cached --others --exclude-standard \
  | grep -zv -E '(^|/)(node_modules|dist|output)/' \
  | tar --null -T - -cf - \
  | tar -xf - -C "$target/source"

echo "== done"
ls -la "$target"
