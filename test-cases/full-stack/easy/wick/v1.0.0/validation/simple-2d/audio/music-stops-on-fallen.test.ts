// Wick — audio/music-stops-on-fallen: `music` is not looping on the frame
// after the run ends fallen.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - specs/ui.md (The loops): "`music` is looping on every frame exactly when
//     `screen` is `playing`, `levelup`, `chest`, or `paused` ... and it stops
//     on the frame the run ends, fallen or at dawn", and "Both loops are
//     reconciled from the state on every frame".
//   - specs/world.md (Fallen and dawn): the row "Fallen | `hp` is `0` or
//     below. | `fallen`", the ending applied "at the end of a tick".
//   - specs/instrumentation.md (`setHp`): "A value at or below `0` ends the
//     run fallen at the end of the next `playing` tick".
//
// WHAT IS READ. `looping("music")` one frame after the ending tick, with the
// loop read once on the run before the ending so a build that never started it
// cannot pass this point by having nothing to stop, and `screen` on `fallen` as
// the evidence that the run really ended.
//
// WHY THE NIGHT IS POSED AS IT IS. An isolated night with nothing on the field,
// no weapon held, and every driver switch off, then one tick to let the loops
// reconcile onto the run. `hp` is posed to `0` rather than driven down by
// contact, because the requirement is about the loop at the ending and not
// about how the health was lost. One spare frame is run after the ending tick,
// the frame the review item names, so a build that stops the loop from the
// following frame's reconciliation passes.
//
// TOLERANCE. The one spare frame above. None on the reading, a boolean.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureReplay,
  createHarness,
  isolate,
  type Harness,
} from "../harness";

/** The health posed: the boundary the ending rule names, "`0` or below". */
const FALLEN_HP = 0;

/** The ending tick, and the one spare frame the review item allows after it. */
const FRAMES = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("stops music by the frame after the run ends fallen", async () => {
  isolate(h);
  await h.tick(1);
  assertEqual(h.looping("music"), true, "music looping on the run");

  h.debug.setHp(FALLEN_HP);
  const after = await captureReplay(h, "stopped", () => h.tick(FRAMES));

  assertEqual(after.screen, "fallen", "the screen after the ending tick");
  assertEqual(
    h.looping("music"),
    false,
    "music looping on the frame after the run ended fallen",
  );
});
