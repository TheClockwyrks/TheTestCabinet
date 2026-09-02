// Wick — audio/music-silent-on-howto: no `music` loop runs on any frame of
// `howto`.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - specs/ui.md (The loops): "`music` is looping on every frame exactly when
//     `screen` is `playing`, `levelup`, `chest`, or `paused` ... `title` and
//     `howto` carry no music", and "Both loops are reconciled from the state on
//     every frame".
//   - specs/instrumentation.md (`setScreen`): the `howto` row, "Enters the
//     how-to screen exactly as confirming `HOW TO PLAY` does: the idle run".
//
// WHAT IS READ. `looping("music")` after each of `LOOP_FRAMES` (60) frames of
// the how-to screen, one frame at a time, so a build that starts the loop
// anywhere in that second fails on the frame it started it. The how-to screen
// is its own point beside the title's, because a build that carries music on
// one and not the other must grade differently from one that carries it on
// neither.
//
// WHY THE SCREEN IS REACHED AS IT IS. Through the debug surface, "exactly as
// the real transition into it enters it", from a reset game with no run behind
// it, so a build with a broken title menu still reaches the screen this point
// is about and no run of any kind is left standing to carry a loop.
//
// TOLERANCE. None. The reading is a boolean, taken on each of 60 frames.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  poseScene,
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

it("runs no music loop on any frame of the how-to screen", async () => {
  const posed = poseScene(h, "howto");
  assertEqual(posed.screen, "howto", "the screen posed");

  await captureReplay(h, "silent", () =>
    assertLoopAcross(
      h,
      "music",
      LOOP_FRAMES,
      false,
      "music looping on the how-to screen",
    ),
  );

  assertEqual(h.snapshot().screen, "howto", "the screen across the frames");
});
