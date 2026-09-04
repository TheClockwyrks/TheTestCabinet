// assets/assets-decoded-before-first-frame — every produced file is loaded
// during initialization, before the build has drawn a frame.
//
// WHAT THIS DECIDES. One reading taken at frame `0`, the moment the build's
// `initialize` resolved and before a single frame has run: every produced
// picture the sprite tables name and every cue file has already announced
// itself loaded through the engine's loader, and nothing announced itself
// failed. So the first frame the build draws has its sprites decoded and its
// cues bound, rather than reaching for them while the night is already
// running.
//
// WHERE THE THRESHOLD COMES FROM. specs/assets.md ("Where the files land, and
// how they are loaded"): "Each image is loaded with `api.assets.loadImage`
// and each audio cue below is bound to its produced file with
// `api.audio.load` under its name in `CUES`, awaited in the instance's
// `initialize`, so every asset is decoded before the first frame." The set is
// the sprite tables and the cue tables of the same file, which
// `src/constants.ts` exports as `LAMPLIGHTER_IDLE_PATH`,
// `LAMPLIGHTER_WALK_SHEET`, `ENEMY_SHEET_DIR`, `PUFF_SHEET`, `GEM_PATHS`,
// `PICKUP_PATHS`, `GROUND_TILE_PATH`, `EFFECT_SPRITES`, `ICON_PATHS` and
// `CUE_PATHS`.
//
// HOW A LOAD IS OBSERVED. Off the engine's own `asset:loaded` and
// `asset:failed` events, which every one of the three loaders emits exactly
// once per call and which the harness subscribes to before `initialize` runs,
// since the engine exists before any game code has. A path that never
// appears was never asked for by the time the frame count stood at `0`.
//
// WHAT IT DELIBERATELY DOES NOT READ. That each file is committed at its
// canvas is the produced points; that a cue is bound to the file of its own
// name is `assets/cues-bound-to-their-files`; and that a URL is written
// against the page is `assets/asset-urls-page-relative`.
//
// WHY NO WORLD IS POSED. The reading is about the boot the build performs, so
// the scenario is the boot: the harness is opened, which is the engine
// initializing the build's game, and nothing is posed, driven, or reset
// before the reading. One frame runs afterwards, for the evidence picture
// alone.
//
// THE TOLERANCE. None: a path either announced itself loaded before the
// first frame or it did not.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, fail } from "../assert";
import { assetFile, CUE_NAMES } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { ALL_SPRITES } from "./produced";
import { cueFile } from "./sounds";

/** Every produced file the build must have decoded, as a repository path. */
const REQUIRED: readonly string[] = [
  ...ALL_SPRITES.map((sprite) => sprite.path),
  ...CUE_NAMES.map((cue) => cueFile(cue)),
];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("decodes every produced file during initialization", async () => {
  // Read FIRST, before anything runs a frame: what the build had loaded by
  // the time its `initialize` resolved.
  const framesDrawn = h.frame();
  const loaded = new Set(h.assetLoads.map((path) => assetFile(path)));
  const failures = h.assetFailures.map(
    (failure) => `${failure.path}: ${failure.reason}`,
  );

  await h.advance(1);
  captureStill(h, "ready");

  assertEqual(framesDrawn, 0, "frames the build had drawn when this was read");
  assertLength(
    failures,
    0,
    `produced files the build failed to load: ${failures.join("; ")}`,
  );
  for (const file of REQUIRED) {
    if (!loaded.has(file)) {
      fail(
        `${file} decoded before the first frame (specs/assets.md, where the files land)`,
        `it was not among the ${loaded.size} files loaded during initialize`,
      );
    }
  }
});
