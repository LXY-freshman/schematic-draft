#!/usr/bin/env bash
# Build the Windows desktop app from WSL and lay the deliverables out on the
# Windows side of the machine.
#
#   scripts/sync-to-windows.sh [target-dir]
#
# target-dir defaults to /mnt/d/AI/Claude/schematic-draft. Afterwards it holds:
#
#   Schematic Draft/   ready-to-run program folder (schematic-draft.exe), which
#                      also holds the Projects/ and AppData/ it writes, so the
#                      whole folder can be moved or copied as one installation
#   release/           the two published downloads: the same program folder as a
#                      zip, and the per-user installer (installer needs Wine)
#   source/            the source tree (no node_modules, no dist)
#   README.md          how to use, what is guaranteed, how to rebuild
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
target="${1:-/mnt/d/AI/Claude/schematic-draft}"
program="$target/Schematic Draft"

# Binaries hosted on GitHub are unreachable from some networks; the npmmirror
# mirrors carry byte-identical copies of the Electron runtime and the
# electron-builder tool bundles.
export ELECTRON_MIRROR="${ELECTRON_MIRROR:-https://npmmirror.com/mirrors/electron/}"
export ELECTRON_BUILDER_BINARIES_MIRROR="${ELECTRON_BUILDER_BINARIES_MIRROR:-https://npmmirror.com/mirrors/electron-builder-binaries/}"

cd "$root"

echo "== building packages and editor"
pnpm build >/dev/null

echo "== building desktop shell"
node apps/desktop/scripts/make-icons.mjs
node apps/desktop/scripts/build.mjs

# The installer is compiled by a Linux-native makensis, but NSIS can only produce
# Uninstall.exe by running the installer stub it just built — a Windows binary,
# hence Wine. The zip is complete without it, so a machine with no Wine gets a
# note and the program folder alone.
installer=""
if command -v wine >/dev/null 2>&1; then
  echo "== packaging (installer + program folder)"
  (cd apps/desktop && ./node_modules/.bin/electron-builder --win nsis --x64 --publish never)
  installer="yes"
else
  echo "== skipping installer: wine not found"
  echo "   (sudo dpkg --add-architecture i386 && sudo apt install wine wine32:i386)"
  echo "== packaging (program folder)"
  (cd apps/desktop && ./node_modules/.bin/electron-builder --win --dir --x64 --publish never)
fi

echo "== packaging (zip)"
node apps/desktop/scripts/package-zip.mjs

echo "== syncing to $target"
mkdir -p "$target" "$target/release"
rm -rf "$target/source"
# Leftovers from earlier layouts: the program folder was `app/`, the single-file
# portable build had `portable/`, and the installer had `installer/`. Remove the
# programs and, as the uninstaller does, leave any saved work behind: rmdir
# refuses a folder that still holds something.
rm -rf "$target/app" "$target/installer"
rm -f "$target"/*-portable.exe
if [ -d "$target/portable" ]; then
  rm -f "$target/portable"/*-portable.exe
  rm -rf "$target/portable/AppData"
  rmdir "$target/portable/Projects" "$target/portable" 2>/dev/null || true
fi

# Replace the program, never the person's work: Projects/ and AppData/ live
# inside the program folder now, so a rebuild keeps them and clears the rest.
if [ -d "$program" ]; then
  find "$program" -mindepth 1 -maxdepth 1 \
    ! -name Projects ! -name AppData -exec rm -rf {} +
fi
mkdir -p "$program"
cp -r output/desktop/win-unpacked/. "$program/"

# The published downloads, side by side: the same program folder as a zip, and
# the installer that lays it down with shortcuts.
rm -f "$target/release"/*.zip "$target/release"/*-setup.exe
cp output/desktop/*-win-x64.zip "$target/release/"
if [ -n "$installer" ]; then
  cp output/desktop/*-setup.exe "$target/release/"
fi
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
