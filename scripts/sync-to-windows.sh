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
#   portable/          single-file portable build of the same app; it keeps its
#                      own Projects/ and AppData/ beside the .exe, which is why
#                      it gets a folder of its own
#   source/            the source tree (no node_modules, no dist)
#   README.md          how to use, what is guaranteed, how to rebuild
#
# The NSIS installer target needs Wine on Linux, so it is not built here; run
# `pnpm --filter @icm/desktop exec electron-builder --win nsis` on a Windows
# host or a Linux box with Wine if an installer is wanted.
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

echo "== packaging (portable exe + unpacked folder)"
(cd apps/desktop && ./node_modules/.bin/electron-builder --win portable --x64 --publish never)

echo "== syncing to $target"
mkdir -p "$target" "$target/portable"
rm -rf "$target/source"
# Leftovers from the previous layout: the program folder was `app/` and the
# portable .exe sat loose in the root. Neither ever held a person's files.
rm -rf "$target/app"
rm -f "$target"/*-portable.exe

# Replace the program, never the person's work: Projects/ and AppData/ live
# inside the program folder now, so a rebuild keeps them and clears the rest.
if [ -d "$program" ]; then
  find "$program" -mindepth 1 -maxdepth 1 \
    ! -name Projects ! -name AppData -exec rm -rf {} +
fi
mkdir -p "$program"
cp -r output/desktop/win-unpacked/. "$program/"
rm -f "$target/portable"/*-portable.exe
cp output/desktop/*-portable.exe "$target/portable/"
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
