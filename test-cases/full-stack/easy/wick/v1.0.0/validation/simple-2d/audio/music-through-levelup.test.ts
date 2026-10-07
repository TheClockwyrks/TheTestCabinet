// Wick — audio/music-through-levelup: `music` is looping on every frame of an
// open level-up overlay.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - specs/ui.md (The loops): "`music` is looping on every frame exactly when
//     `screen` is `playing`, `levelup`, `chest`, or `paused` ... and keeps
//     playing through the overlays and the pause".
//   - specs/ui.md (The loops): "Both loops are reconciled from the state on
//     every frame", so every frame of the overlay is a frame the reading
//     applies to.
//   - specs/progression.md: "A `playing` tick that ends with `pendingLevelUps`
//     above `0` runs to completion and then opens the overlay", and "the
//     simulation does not tick while it is open".
//   - specs/instrumentation.md (`setPendingLevelUps`): "A `playing` tick that
//     ends with it above `0` opens the overlay exactly as a gain does".
//
// WHAT IS READ. `looping("music")` after each of `LOOP_FRAMES` (60) frames of
// the open overlay, one frame at a time, so a build that dropped the loop
// anywhere inside that second fails on the frame it dropped it. The loop is
// read once before the overlay opens as well, since a reading that the loop
// survived an overlay says nothing if it was never running.
//
// WHY THE NIGHT IS POSED AS IT IS. An isolated night with nothing on the field,
// no weapon held, and every driver switch off, then one tick to let the loops
// reconcile onto the run. The overlay is opened from a queued level-up rather
// than from a gem, so no collection, kill, or ending can end the run or change
// the screen under the reading, and the screen stays `levelup` for every frame
// walked.
//
// TOLERANCE. None. The reading is a boolean, taken on each of 60 frames.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";
import { LOOP_FRAMES, assertLoopAcross } from "./cues";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("keeps music looping on every frame of the open overlay", async () => {
  isolate(h);
  await h.tick(1);
  assertEqual(h.looping("music"), true, "music looping on the run beneath");

  const opened = await openLevelUp(h, 1);
  assertEqual(opened.screen, "levelup", "the screen the overlay opened on");

  await captureReplay(h, "levelup", () =>
    assertLoopAcross(
      h,
      "music",
      LOOP_FRAMES,
      true,
      "music looping under the level-up overlay",
    ),
  );

  assertEqual(h.snapshot().screen, "levelup", "the screen across the frames");
});
