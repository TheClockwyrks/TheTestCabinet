// Wick — assets/build-self-contained: the project installs and builds where the
// asset tools are absent, and the built site fetches nothing from outside it.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - specs/assets.md (the opening): "Production is a one-time step. The tools
//     belong to this machine and are absent when the project is installed and
//     rebuilt elsewhere, so the committed files are the assets: `npm ci` and
//     `npm run build` invoke no tool, and the built site fetches nothing from
//     outside its own `dist/`. A build that shells out to a generation tool
//     fails wherever the tools are absent, even though the game is complete."
//   - specs/assets.md (The tools): the six binaries on this machine's `PATH`,
//     `draw`, `draw-sheet`, `sfx-synth`, `sfx-sample`, `music`, and
//     `particle-2d`.
//
// WHAT IS READ, IN THREE PARTS.
//   1. The INSTALL half, statically: `npm ci` runs the package's install
//      lifecycle scripts, so none of them may name an asset tool. Reinstalling
//      dependencies for real needs the network, which a validator must not.
//   2. The BUILD half, for real: the committed tree is copied to a scratch
//      directory with its installed dependencies shared by symlink, every asset
//      tool on `PATH` is replaced by a shim that records being called and exits
//      non-zero, and `npm run build` is run there. It must complete, leave a
//      non-empty output directory, and have invoked no shim. A build that
//      shells out to a tool is named by the tool it called.
//   3. The OUTPUT: no `src` or `href` in the built `index.html` carries a URI
//      scheme or a protocol-relative host, which is what "fetches nothing from
//      outside its own `dist/`" rules out.
//
// WHY THE REBUILD HAPPENS IN A COPY. `vite build` rewrites the output directory
// and the other suites of this project are driving the build in the workspace
// at the same time, so the rebuild happens beside them and is thrown away.
//
// WHY A NIGHT IS DRIVEN AT ALL. Only for the evidence: the still is the
// committed tree running, so a reviewer sees that the files this point proved
// self-contained are the ones this game is made of. Nothing about the still is
// read by an assertion, so a build whose debug surface cannot pose the night
// loses the still and keeps the verdict: the three readings below are facts
// of the committed tree, which the surface never touches.
//
// TOLERANCE. None. Each of the three readings is a list that is empty or is not.

import { afterEach, beforeEach, it } from "vitest";
import { fail } from "../assert";
import { captureStill, createHarness, isolate, type Harness } from "../harness";
import { installLifecycleToolCommands, rebuildWithoutTools } from "./rebuild";

/** The rebuild runs a real `npm run build`; the suite's own budget covers it. */
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
    try {
      isolate(h);
      await h.frameDraw();
      captureStill(h, "built");
    } catch {
      // Evidence only; the rebuild below carries the verdict.
    }

    const lifecycle = installLifecycleToolCommands();
    if (lifecycle.length > 0) {
      fail(
        "install lifecycle scripts that invoke no asset tool, so `npm ci` " +
          "completes where the tools are absent (specs/assets.md)",
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
        "`npm run build` completing from the committed tree with the asset " +
          "tools absent",
        `it failed: ${rebuilt.failure ?? "with no output"}`,
      );
    }
    if (!rebuilt.builtOutput) {
      fail(
        "`npm run build` leaving a non-empty output directory (dist/, build/, " +
          "or out/)",
        "the rebuild completed but left no build output",
      );
    }
    if (rebuilt.externalHtmlRefs.length > 0) {
      fail(
        "a built page that fetches nothing from outside its own dist/",
        `index.html references: ${rebuilt.externalHtmlRefs.join(", ")}`,
      );
    }
  },
  BUDGET_MS,
);
