// Wick — audio/music-through-chest: `music` is looping on every frame of an
// open chest overlay.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - specs/ui.md (The loops): "`music` is looping on every frame exactly when
//     `screen` is `playing`, `levelup`, `chest`, or `paused` ... and keeps
//     playing through the overlays and the pause", and "Both loops are
//     reconciled from the state on every frame".
//   - specs/progression.md (The chest overlay): "On the tick it is collected
//     ... `screen` becomes `chest` ... The simulation does not tick while the
//     overlay is open".
//   - specs/instrumentation.md (`setScreen`): the chest overlay "is reached
//     through `spawnPickup("chest", x, y)` at the lamplighter's center and one
//     tick, which is the real collection path".
//
// WHAT IS READ. `looping("music")` after each of `LOOP_FRAMES` (60) frames of
// the open overlay, one frame at a time, with the loop read once before the
// chest is collected so the reading has something to survive.
//
// WHY THE NIGHT IS POSED AS IT IS. An isolated night with nothing on the field,
// no weapon or passive held, and every driver switch off, then one tick to let
// the loops reconcile onto the run. With nothing held the chest's result is the
// heal of rule 3 (specs/evolutions.md), the result that changes the least about
// the run under the overlay, and no enemy, gem, or pickup can change the screen
// while the frames are walked.
//
// TOLERANCE. None. The reading is a boolean, taken on each of 60 frames.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  isolate,
  openChest,
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

it("keeps music looping on every frame of the open chest overlay", async () => {
  isolate(h);
  await h.tick(1);
  assertEqual(h.looping("music"), true, "music looping on the run beneath");

  const opened = await openChest(h);
  assertEqual(opened.screen, "chest", "the screen the overlay opened on");

  await captureReplay(h, "chest", () =>
    assertLoopAcross(
      h,
      "music",
      LOOP_FRAMES,
      true,
      "music looping under the chest overlay",
    ),
  );

  assertEqual(h.snapshot().screen, "chest", "the screen across the frames");
});
