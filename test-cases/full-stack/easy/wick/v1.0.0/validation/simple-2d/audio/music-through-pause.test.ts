// Wick — audio/music-through-pause: `music` is looping on every frame of
// `paused`.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - specs/ui.md (The loops): "`music` is looping on every frame exactly when
//     `screen` is `playing`, `levelup`, `chest`, or `paused` ... and keeps
//     playing through the overlays and the pause", and "Both loops are
//     reconciled from the state on every frame".
//   - specs/ui.md (`paused`): "The world held still, with the HUD, under
//     `PAUSED_TEXT`".
//   - specs/instrumentation.md (`setScreen`): the `paused` row, "Exactly as
//     `pause` does; the accumulator is discarded as on any frame that leaves
//     `playing`".
//
// WHAT IS READ. `looping("music")` after each of `LOOP_FRAMES` (60) frames of
// `paused`, one frame at a time, with the loop read once on the run before the
// pause so the reading has something to survive.
//
// WHY THE NIGHT IS POSED AS IT IS. An isolated night with nothing on the field,
// no weapon held, and every driver switch off, then one tick to let the loops
// reconcile onto the run. The pause is entered through the surface rather than
// by pressing `P`, because a build with a broken `pause` binding must fail the
// controls point and this one is about the loop; and nothing on the held night
// can change the screen while the frames are walked.
//
// TOLERANCE. None. The reading is a boolean, taken on each of 60 frames.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  isolate,
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

it("keeps music looping on every frame of paused", async () => {
  isolate(h);
  await h.tick(1);
  assertEqual(h.looping("music"), true, "music looping on the run beneath");

  h.debug.setScreen("paused");
  assertEqual(h.snapshot().screen, "paused", "the screen the pause entered");

  await captureReplay(h, "paused", () =>
    assertLoopAcross(
      h,
      "music",
      LOOP_FRAMES,
      true,
      "music looping under the pause",
    ),
  );

  assertEqual(h.snapshot().screen, "paused", "the screen across the frames");
});
