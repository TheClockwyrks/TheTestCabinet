// Wick — audio/hum-starts-on-resume: with Halo held, `hum` is not looping on
// `paused` and is looping on the frame after play resumes.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - specs/ui.md (The loops): "`hum` is looping on every frame exactly when
//     `screen` is `playing` and a held weapon is `halo` or `corona`. It starts
//     on the frame that first makes both true, whether Halo was just acquired
//     or play just resumed from an overlay or a pause, and it stops on the
//     frame either stops being true".
//   - specs/ui.md (`paused`): "`pause` returns to `playing`".
//   - specs/instrumentation.md (`setScreen`): the `playing` from `paused` row,
//     "Resumes exactly as `pause` on `paused` does; the run is untouched"; a
//     pose "sounds nothing".
//   - specs/instrumentation.md: "The two looping cues are reconciled from the
//     state by the next frame, so a run posed through `setScreen("playing")`
//     sounds exactly as one started from the menu one frame later".
//
// WHAT IS READ. `looping("hum")` one frame into `paused` with Halo held, which
// is `false` because the screen is not `playing`, and again one frame after the
// resume, which is `true`. This is the second of the two routes the
// specification names for a start, and its own point beside the acquisition.
//
// WHY THE NIGHT IS POSED AS IT IS. An isolated night with nothing on the field
// and every driver switch off, holding Halo alone, and one tick before the
// pause so the run the pause holds is a settled one. Both screen changes go
// through the surface, "exactly as the real transition into it enters it", so a
// build with a broken `pause` binding fails the controls point rather than this
// one.
//
// TOLERANCE. None. Both readings are booleans.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  holdWeapon,
  isolate,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("holds the hum off on paused and starts it on the frame after the resume", async () => {
  isolate(h);
  holdWeapon(h, "halo", 1);
  await h.tick(1);

  h.debug.setScreen("paused");
  const paused = await h.tick(1);
  assertEqual(paused.screen, "paused", "the screen the pause entered");
  assertEqual(h.looping("hum"), false, "hum looping on paused with Halo held");

  h.debug.setScreen("playing");
  const resumed = await captureReplay(h, "resumed", () => h.tick(1));

  assertEqual(resumed.screen, "playing", "the screen the resume returned to");
  assertEqual(
    h.looping("hum"),
    true,
    "hum looping on the frame after play resumed",
  );
});
