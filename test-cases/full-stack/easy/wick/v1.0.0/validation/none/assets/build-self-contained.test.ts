// assets/build-self-contained — the build invokes no asset tool.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md: "Production is a one-time
// step. The tools belong to this machine and are absent when the project is
// installed and rebuilt elsewhere, so the committed files are the assets: `npm
// ci` and `npm run build` invoke no tool, and the built site fetches nothing from
// outside its own `dist/`. A build that shells out to a generation tool fails
// wherever the tools are absent, even though the game is complete."
//
// THE DRIVE. The build half is run FOR REAL: `npm run build` in a scratch copy of
// the committed tree, with every tool specs/assets.md names shimmed to record
// being called — so a tree that shells out to `draw` or `music` fails by the
// tool's name, and a tree that needs anything beyond its committed files and its
// installed dependencies fails to complete. The install half is read statically
// off the lifecycle scripts `npm ci` would run, because reinstalling dependencies
// needs the network a validator must not. "Fetches nothing from outside itself"
// is read off the rebuilt page: no reference in its `index.html` carries a scheme
// or a protocol-relative host.
//
// THE TOLERANCE. None: a tool was invoked or it was not, and the rebuild
// completed or it did not.
//
// WHAT IT DELIBERATELY DOES NOT READ. That the produced files themselves are at
// their paths is every other point in this category; that the URLs the built site
// requests resolve against the page is `assets/asset-urls-page-relative`.
//
// THE STILL keeps the committed build running, as the evidence that the game
// those files make is this one.

import { afterEach, beforeEach, it } from "vitest";
import { fail } from "../assert";
import { captureStill, createHarness, type Harness } from "../harness";
import { installLifecycleToolCommands, rebuildWithoutTools } from "./rebuild";

/** Generous against a full rebuild of the committed tree on a loaded host. */
const TIMEOUT_MS = 300_000;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it(
  "rebuilds from the committed tree without invoking a generation tool",
  async () => {
    try {
      await h.step(1);
      await captureStill(h, "built");
    } catch {
      // Evidence only; the rebuild below carries the verdict.
    }

    const lifecycle = installLifecycleToolCommands();
    if (lifecycle.length > 0) {
      fail(
        "install lifecycle scripts that invoke no generation tool, so `npm ci` completes where the tools are absent",
        `package.json runs a tool at install time: ${lifecycle.join("; ")}`,
      );
    }

    const rebuilt = rebuildWithoutTools();
    if (rebuilt.toolsInvoked.length > 0) {
      fail(
        "`npm run build` completing without invoking a generation tool (specs/assets.md — production is a one-time step)",
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
  TIMEOUT_MS,
);
