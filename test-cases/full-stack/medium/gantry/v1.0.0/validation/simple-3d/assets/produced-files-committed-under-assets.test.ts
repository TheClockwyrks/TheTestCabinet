// assets/produced-files-committed-under-assets — every produced file is
// committed under the one root.
//
// specs/assets.md, intro: "Commit the produced files under `assets/`, at these
// paths: each model as `assets/models/<model>.glb` … each cue's sound as
// `assets/audio/<cue>.wav` … and the music bed as `assets/audio/music.wav` with
// `assets/audio/music.mid` beside it." And, under "Consuming a model": "Its
// asset loader resolves every path under one root, `ASSET_ROOT` (`assets/`)".
//
// ONE ROOT IS THE REQUIREMENT, and it is what this point decides: `assets/`
// stands at the repository root, and every produced file — every `.glb`, `.wav`
// and `.mid` the repository carries — sits under it. A build that commits a
// model beside its source, or a cue in `public/`, has files the one root does
// not reach, which is what the requirement exists to prevent.
//
// THE TREE IS WALKED, NOT THE MANIFEST. The point is about files that are
// committed rather than about files the site loads, so this reads the build
// workspace off disk, which is this validator project's own root.
//
// WHAT IS SKIPPED, AND WHY. `node_modules/` is installed rather than committed
// and carries other packages' fixtures. `dist/` is the build's output — the
// bundler emits a copy of every produced file into it, and those copies are
// `assets/no-runtime-fetch-outside-dist`'s business rather than this point's.
// `validation/` is the case's own validator project, staged into the build's
// tree by the runner and not the build's at all. Version-control and editor
// bookkeeping directories are skipped for the same reason as `node_modules`.
// Everything else the repository carries is read.

import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { createHarness, type Harness } from "../harness";

/** The build workspace: this suite is staged at `<workspace>/validation/assets/`. */
const WORKSPACE = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

/** The one root `specs/assets.md` commits the produced files under. */
const ROOT = "assets";

/** Directories that are not the build's committed source. */
const SKIPPED = new Set([
  "node_modules",
  "dist",
  "validation",
  ".git",
  ".hg",
  ".svn",
  ".cache",
  ".vscode",
  ".idea",
]);

/** The extensions the three tools produce (`specs/assets.md`, "The tools"). */
const PRODUCED = /\.(glb|wav|mid)$/i;

/** Every produced file the tree carries, as workspace-relative POSIX paths. */
function walk(at: string, found: string[]): string[] {
  for (const entry of readdirSync(at, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIPPED.has(entry.name)) continue;
      walk(join(at, entry.name), found);
      continue;
    }
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;
    if (!PRODUCED.test(entry.name)) continue;
    found.push(relative(WORKSPACE, join(at, entry.name)).split(sep).join("/"));
  }
  return found;
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("carries every produced .glb, .wav and .mid under assets/", async () => {
  const root = join(WORKSPACE, ROOT);
  assertTrue(
    existsSync(root) && statSync(root).isDirectory(),
    `an \`${ROOT}/\` directory at the repository root, which is the one root ` +
      "every produced file is committed under and every asset path resolves " +
      "against (specs/assets.md)",
  );

  const produced = walk(WORKSPACE, []).sort();
  assertTrue(
    produced.length > 0,
    "the repository to carry produced files at all — eight `.glb` models, " +
      "twelve `.wav` sounds and the bed's `.mid` (specs/assets.md)",
  );

  const stray = produced.filter((path) => !path.startsWith(`${ROOT}/`));
  assertEqual(
    stray.join(", "),
    "",
    `every produced \`.glb\`, \`.wav\` and \`.mid\` to sit under \`${ROOT}/\`, ` +
      "so one root reaches all of them (specs/assets.md) — these sit outside it",
  );

  console.log(
    `gantry: the committed produced files under ${ROOT}/ —\n  ` +
      produced.join("\n  "),
  );

  await h.capture("tree", "The committed produced files under assets/");
});
