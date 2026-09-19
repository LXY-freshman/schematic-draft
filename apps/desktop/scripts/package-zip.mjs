import { execFileSync } from "node:child_process";
import { readFile, rename, rm, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";

/**
 * Pack the ready-to-run program folder into the release zip.
 *
 * One of the two downloads a release offers: extract it and the folder inside is
 * a complete installation, the same bytes the installer would lay down. The
 * folder holds the `Projects\` and `AppData\` it writes, so moving it moves
 * everything.
 *
 * electron-builder has a `zip` target, and it is not usable here: for Windows it
 * archives the contents of `win-unpacked` without the directory itself
 * (`withoutDir = true` in app-builder-lib's ArchiveTarget), so extracting would
 * spill two hundred files into whatever folder the person was sitting in.
 *
 * So the folder is renamed to the name it should carry inside the archive,
 * zipped, and renamed back. A rename within one directory is instant and
 * atomic; copying 327 MB to stage it would not be.
 */
const root = resolve(import.meta.dirname, "..");
const outDir = resolve(root, "../../output/desktop");
const manifest = JSON.parse(
  await readFile(resolve(root, "package.json"), "utf8"),
);

const unpacked = resolve(outDir, "win-unpacked");
const staged = resolve(outDir, manifest.productName);
const archive = resolve(
  outDir,
  `schematic-draft-${manifest.version}-win-x64.zip`,
);

if (
  await stat(unpacked).then(
    () => false,
    () => true,
  )
) {
  console.error(
    `No program folder at ${unpacked}.\nRun electron-builder first: pnpm --filter @icm/desktop dist:win`,
  );
  process.exit(1);
}

// zip adds to an archive that already exists, which would keep the files of
// every previous version forever.
await rm(archive, { force: true });

await rename(unpacked, staged);
try {
  console.log(`packaging ${basename(archive)} (a minute or so)`);
  execFileSync(
    "zip",
    ["--recurse-paths", "-9", "-X", "--quiet", archive, basename(staged)],
    { cwd: outDir, stdio: "inherit" },
  );
} catch (error) {
  if (error.code === "ENOENT") {
    console.error("`zip` is not installed. sudo apt install zip");
  }
  throw error;
} finally {
  await rename(staged, unpacked);
}

const { size } = await stat(archive);
console.log(`  ${archive} — ${Math.round(size / 1024 / 1024)} MB`);
