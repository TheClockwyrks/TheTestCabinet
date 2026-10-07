// Wick — assets/assets-decoded-before-first-frame: every produced file is
// loaded and decoded before the game draws anything.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - specs/assets.md (Where the files land): "Each image is loaded with
//     `api.assets.loadImage` and each audio cue below is bound to its produced
//     file with `api.audio.load` under its name in `CUES`, awaited in
//     `initialize`, so every asset is decoded before the first frame."
//   - The Simple 2D engine announces the outcome of every load as an engine
//     event, and `api.audio.load` "resolves the path through the asset loader,
//     so it ... emits the same `asset:loaded` and `asset:failed` events", which
//     is how a check sees what was decoded and when.
//   - The tables of specs/assets.md fix which files there are: the lamplighter's
//     idle and six-frame walk, thirteen enemy sheets of four, the puff, the
//     gems, the pickups, the ground tile, the sixteen effects, the twenty-seven
//     icons, and the fifteen cue files including the bed.
//
// WHAT IS READ. Off a harness that has run NO frame yet — `initialize` has
// resolved and nothing has been advanced — every produced image path and every
// cue's file has already been announced loaded, and nothing was announced
// failed. A build that loads on demand, or that leaves a load unawaited, has
// not announced them by then and fails here.
//
// WHY THAT IS THE FIRST FRAME. The harness builds the engine, awaits
// `engine.initialize()`, and hands back a harness at frame `0`; the first frame
// the build draws is the next `advance`. So the reading taken before that
// advance is exactly "before the first frame", and the frame then run is the
// title frame the still keeps.
//
// WHAT IT DELIBERATELY DOES NOT READ. That each file is at its stated canvas is
// the `*-produced` points'; that a cue plays the file of its own name is
// `assets/cues-bound-to-their-files`; which sprite the first frame drew is the
// presentation category's.
//
// WHY NO NIGHT IS POSED. The reading is about the boot, so posing anything
// would run the ticks it is about not running. The harness is opened and read.
//
// TOLERANCE. None. The readings are set membership and a frame count.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, fail } from "../assert";
import { CUE_NAMES, CUE_PATHS } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { ALL_SPRITES } from "./produced";

/** Every path `specs/assets.md` has the build load, images then cues. */
const REQUIRED_PATHS: readonly string[] = [
  ...ALL_SPRITES.map((sprite) => sprite.path),
  ...CUE_NAMES.map((cue) => CUE_PATHS[cue]),
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("decodes every produced file before the first frame draws", async () => {
  const beforeFirstFrame = h.frame();
  const loaded = new Set(h.assetsLoaded.map((asset) => asset.path));
  const failures = h.assetFailures.map((asset) => asset.path);
  const missing = REQUIRED_PATHS.filter((path) => !loaded.has(path));

  await h.frameDraw();
  captureStill(h, "ready");

  assertEqual(beforeFirstFrame, 0, "frames drawn when the loads were read");
  assertLength(
    failures,
    0,
    `produced files that failed to load: ${failures.join(", ")}`,
  );
  if (missing.length > 0) {
    fail(
      "every produced file loaded and decoded before the first frame " +
        "(specs/assets.md, awaited in initialize)",
      `${missing.length} were not: ${missing.slice(0, 8).join(", ")}`,
    );
  }
});
