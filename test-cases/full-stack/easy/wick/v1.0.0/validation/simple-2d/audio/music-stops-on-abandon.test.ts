// Wick — audio/music-stops-on-abandon: `music` is not looping on the frame
// after `back` on `paused` returns to the title.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - specs/ui.md (The loops): "`music` is looping on every frame exactly when
//     `screen` is `playing`, `levelup`, `chest`, or `paused` ... or `back` on
//     `paused` abandons it. `title` and `howto` carry no music", and "Both
//     loops are reconciled from the state on every frame".
//   - specs/ui.md (`paused`): "`back` abandons the run and returns to `title`
//     with `menuIndex = 0`".
//   - specs/controls.md: `back` is bound to `Escape` and is read as a press
//     edge; on `paused` it "abandons the run and returns to `title`".
//
// WHAT IS READ. `looping("music")` one frame after the press that abandoned the
// run, with the loop read once on the pause before the press so a build that
// never started it cannot pass by having nothing to stop, and `screen` on
// `title` as the evidence that the run really was abandoned.
//
// WHY THE NIGHT IS POSED AS IT IS. An isolated night with nothing on the field,
// no weapon held, and every driver switch off, then one tick to let the loops
// reconcile onto the run. The pause is entered through the surface, "Exactly as
// `pause` does" (specs/instrumentation.md), so a broken `pause` binding fails
// the controls point rather than this one; the abandon itself is a real
// `Escape` press, because the requirement names that press. One spare frame is
// run after it, the frame the review item names.
//
// TOLERANCE. The one spare frame above. None on the reading, a boolean.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  isolate,
  tap,
  type Harness,
} from "../harness";
import { BACK_KEY } from "./cues";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("stops music by the frame after back on paused abandons the run", async () => {
  isolate(h);
  await h.tick(1);
  h.debug.setScreen("paused");
  await h.tick(1);
  assertEqual(h.looping("music"), true, "music looping on the pause");

  const after = await captureReplay(h, "stopped", async () => {
    await tap(h, BACK_KEY);
    return h.tick(1);
  });

  assertEqual(after.screen, "title", "the screen the abandon returned to");
  assertEqual(
    h.looping("music"),
    false,
    "music looping on the frame after the run was abandoned",
  );
});
