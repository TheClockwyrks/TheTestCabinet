// Wick — audio/cue-dawn: the tick `36000` that ends the run at dawn plays
// `dawn`.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - specs/ui.md (Audio): "`dawn` | `CUES.dawn` | The run ends at dawn", and
//     "Each is played on the tick its event happens".
//   - specs/world.md (Fallen and dawn): the row "Dawn | `tick` equals
//     `DAWN_TIME × TICK_HZ` (`36000`). | `dawn`", and "A run ends at the end of
//     a tick, after every other phase of that tick has been applied".
//   - specs/world.md (One tick, phase 1): "The clock. `tick` rises by one".
//   - specs/instrumentation.md (`setTick`): "Sets `tick` to `tick`, a whole
//     number from `0` to `DAWN_TIME × TICK_HZ − 1` (`35999`). Nothing else
//     changes"; a pose "sounds nothing".
//
// WHAT IS READ. Exactly one `dawn` play across the one tick that carries the
// clock to `36000`, with `screen` on `dawn` and `tick` at `DAWN_TICK` as the
// evidence that the ending is the one the cue is about.
//
// WHY THE NIGHT IS POSED AS IT IS. An isolated night with nothing on the field,
// no weapon held, and every driver switch off, so no enemy spawns, nothing is
// hit or killed, and the ending tick raises no other cue. The clock is posed to
// `35999`, the last value `setTick` accepts, so exactly one tick reaches dawn
// and the reading covers that tick alone.
//
// TOLERANCE. None. The reading is a count, and the tick and screen are
// discrete.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { DAWN_TICK } from "../constants";
import {
  captureReplay,
  createHarness,
  isolate,
  onCue,
  type Harness,
} from "../harness";
import { assertPlayed } from "./cues";

/** The tick posed: one short of dawn, and the largest `setTick` accepts. */
const BEFORE_DAWN = DAWN_TICK - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("plays dawn once on the tick the clock reaches 36000", async () => {
  isolate(h);
  h.debug.setTick(BEFORE_DAWN);
  const cues = onCue(h);

  const after = await captureReplay(h, "dawn", () => h.tick(1));

  assertEqual(after.run.tick, DAWN_TICK, "the clock after the ending tick");
  assertEqual(after.screen, "dawn", "the screen after the ending tick");
  assertPlayed(cues, "dawn", 1, "dawn cues on the tick the night ended");
});
