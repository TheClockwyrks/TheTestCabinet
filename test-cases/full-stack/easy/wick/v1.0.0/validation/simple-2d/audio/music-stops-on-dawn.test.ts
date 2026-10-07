// Wick — audio/music-stops-on-dawn: `music` is not looping on the frame after
// the run ends at dawn.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - specs/ui.md (The loops): "`music` ... stops on the frame the run ends,
//     fallen or at dawn", and "Both loops are reconciled from the state on
//     every frame".
//   - specs/world.md (Fallen and dawn): the row "Dawn | `tick` equals
//     `DAWN_TIME × TICK_HZ` (`36000`). | `dawn`", the ending applied "at the
//     end of a tick, after every other phase of that tick has been applied".
//   - specs/instrumentation.md (`setTick`): "Sets `tick` to `tick`, a whole
//     number from `0` to `DAWN_TIME × TICK_HZ − 1` (`35999`). Nothing else
//     changes".
//
// WHAT IS READ. `looping("music")` one frame after the tick that carried the
// clock to `36000`, with the loop read once on the run before the ending so a
// build that never started it cannot pass by having nothing to stop, and
// `screen` on `dawn` as the evidence that the run ended that way. Dawn is its
// own point beside `fallen`, because a build that stops the loop on one ending
// and not the other must grade differently from one that stops it on both.
//
// WHY THE NIGHT IS POSED AS IT IS. An isolated night with nothing on the field,
// no weapon held, and every driver switch off, then one tick to let the loops
// reconcile onto the run. The clock is then posed to `35999`, so exactly one
// tick reaches dawn and nothing else happens on the way. One spare frame is run
// after the ending tick, the frame the review item names.
//
// TOLERANCE. The one spare frame above. None on the reading, a boolean.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { DAWN_TICK } from "../constants";
import {
  captureReplay,
  createHarness,
  isolate,
  type Harness,
} from "../harness";

/** The tick posed: one short of dawn, and the largest `setTick` accepts. */
const BEFORE_DAWN = DAWN_TICK - 1;

/** The ending tick, and the one spare frame the review item allows after it. */
const FRAMES = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("stops music by the frame after the run ends at dawn", async () => {
  isolate(h);
  await h.tick(1);
  assertEqual(h.looping("music"), true, "music looping on the run");

  h.debug.setTick(BEFORE_DAWN);
  const after = await captureReplay(h, "stopped", () => h.tick(FRAMES));

  assertEqual(after.screen, "dawn", "the screen after the ending tick");
  assertEqual(
    h.looping("music"),
    false,
    "music looping on the frame after the run ended at dawn",
  );
});
