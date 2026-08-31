// assets/build-self-contained — the build invokes no asset tool.
//
// specs/assets.md: "Production is a one-time step. The tools belong to this
// machine and are absent when the project is installed and rebuilt elsewhere,
// so the committed files are the assets: `npm ci` and `npm run build` invoke
// no tool, and the built site fetches nothing from outside its own `dist/`."
//
// The build half is run FOR REAL: `npm run build` in a scratch copy of the
// committed tree, with every generation tool shimmed to record being called —
// so a tree that shells out to `draw` or `music` fails by the tool's name, and
// a tree that needs anything beyond its committed files and installed
// dependencies fails to complete. The install half is read statically off the
// lifecycle scripts `npm ci` would run, because reinstalling dependencies
// needs the network a validator must not. "Fetches nothing from outside
// itself" is read off the rebuilt page: no reference in its `index.html`
// carries a scheme or a protocol-relative host. The still keeps the committed
// build running as the evidence that the game those files make is this one.

import { afterEach, beforeEach, it } from "vitest";
import { fail } from "../assert";
import { captureStill, openHarness, type Harness } from "../harness";
import { installLifecycleToolCommands, rebuildWithoutTools } from "./rebuild";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

it(
  "rebuilds from the committed tree without invoking a generation tool",
  async () => {
    try {
      await h.tick(1);
      await captureStill(h, "built-game");
    } catch {
      // Evidence only; the rebuild below carries the verdict.
    }

    const lifecycleHits = installLifecycleToolCommands();
    if (lifecycleHits.length > 0) {
      fail(
        "install lifecycle scripts that invoke no generation tool, so `npm ci` completes where the tools are absent",
        `package.json runs a tool at install time: ${lifecycleHits.join("; ")}`,
      );
    }

    const rebuilt = rebuildWithoutTools();
    if (rebuilt.toolsInvoked.length > 0) {
      fail(
        "`npm run build` completing without invoking a generation tool (specs/assets.md, production is a one-time step)",
        `the build invoked: ${rebuilt.toolsInvoked.join(", ")}`,
      );
    }
    if (!rebuilt.completed) {
      fail(
        "`npm run build` completing from the committed tree with the generation tools absent",
        `it failed: ${rebuilt.failure ?? "with no output"}`,
      );
    }
    if (!rebuilt.builtOutput) {
      fail(
        "`npm run build` producing a non-empty output directory (dist/, build/, or out/)",
        "the rebuild completed but left no build output",
      );
    }
    if (rebuilt.externalHtmlRefs.length > 0) {
      fail(
        "a built page that fetches nothing from outside its own output",
        `index.html references: ${rebuilt.externalHtmlRefs.join(", ")}`,
      );
    }
  },
  300_000,
);
