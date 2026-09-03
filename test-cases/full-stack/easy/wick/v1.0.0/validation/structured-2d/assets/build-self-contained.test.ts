// assets/build-self-contained — the committed tree installs and rebuilds where
// no asset tool exists, and what it builds fetches nothing from outside itself.
//
// WHAT THIS DECIDES. Three readings of the same sentence, in the order an
// installer meets them: `npm ci` runs no lifecycle script that names a
// generation tool, `npm run build` completes and leaves a build with every
// tool on `PATH` replaced by a shim that fails, and the built page names no
// URL that leaves the build's own output.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md (the opening): "Production
// is a one-time step. The tools belong to this machine and are absent when
// the project is installed and rebuilt elsewhere, so the committed files are
// the assets: `npm ci` and `npm run build` invoke no tool, and the built site
// fetches nothing from outside its own `dist/`. A build that shells out to a
// generation tool fails wherever the tools are absent, even though the game
// is complete." The tools are the five of its tool table plus `particle-2d`,
// which "is on the `PATH` as well"; `assets/rebuild.ts` holds that list.
//
// HOW THE TWO HALVES ARE READ. The BUILD half is run for real, so what is
// decided is what the build did rather than what its scripts appear to say:
// the committed tree is copied beside itself, a recording shim that exits
// non-zero stands at the front of `PATH` for every tool, and `npm run build`
// runs there. The INSTALL half is read statically off the package's install
// lifecycle scripts, because running `npm ci` for real needs the network,
// which a validator must not.
//
// WHY THE REBUILD HAPPENS IN A COPY. `vite build` rewrites the output
// directory, and the other suites of this project drive the workspace's build
// at the same time, so the rebuild happens in a scratch directory that is
// thrown away and the installed dependencies are shared into it by symlink.
//
// WHY A NIGHT IS DRIVEN AT ALL. For the evidence alone. The still is the
// committed tree running, so a reviewer sees that the files this point proved
// self-contained are the ones this game is made of; no assertion reads it.
// The world is isolated first so the frame is the posed one rather than
// whatever a director spawn happened to put on it.
//
// THE TOLERANCE. None. Each of the three readings is a list that is empty or
// is not.

import { afterEach, beforeEach, it } from "vitest";
import { fail } from "../assert";
import { captureStill, createHarness, isolate, type Harness } from "../harness";
import { installLifecycleToolCommands, rebuildWithoutTools } from "./rebuild";

/** A leading URI scheme: `http:`, `data:`, `file:`, and the rest. */
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** A reference the built page resolves outside its own output. */
function leavesTheBuild(ref: string): boolean {
  return SCHEME.test(ref) || ref.startsWith("//");
}

/** The rebuild runs a real `npm run build`; the point's own budget covers it. */
const BUDGET_MS = 300_000;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it(
  "installs and rebuilds from the committed tree with no asset tool on PATH",
  async () => {
    isolate(h);
    await h.frameDraw();
    captureStill(h, "built");

    const lifecycle = installLifecycleToolCommands();
    if (lifecycle.length > 0) {
      fail(
        "install lifecycle scripts naming no asset tool, so `npm ci` " +
          "completes where the tools are absent (specs/assets.md, production " +
          "is a one-time step)",
        `package.json runs a tool at install time: ${lifecycle.join("; ")}`,
      );
    }

    const rebuilt = rebuildWithoutTools();
    if (rebuilt.toolsInvoked.length > 0) {
      fail(
        "`npm run build` completing without invoking an asset tool " +
          "(specs/assets.md, production is a one-time step)",
        `the build invoked: ${rebuilt.toolsInvoked.join(", ")}`,
      );
    }
    if (!rebuilt.completed) {
      fail(
        "`npm run build` completing from the committed tree with every " +
          "asset tool absent (specs/assets.md)",
        `it failed: ${rebuilt.failure ?? "with no output"}`,
      );
    }
    if (!rebuilt.builtOutput) {
      fail(
        "`npm run build` leaving a non-empty build output (dist/, build/, " +
          "or out/)",
        "the rebuild completed but left no build output",
      );
    }
    const external = rebuilt.htmlRefs.filter(leavesTheBuild);
    if (external.length > 0) {
      fail(
        "a built page that fetches nothing from outside its own dist/ " +
          "(specs/assets.md)",
        `${rebuilt.outputDir ?? "the build"}/index.html references: ${external.join(", ")}`,
      );
    }
  },
  BUDGET_MS,
);
