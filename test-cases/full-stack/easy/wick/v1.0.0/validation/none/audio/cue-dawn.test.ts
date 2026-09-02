// audio/cue-dawn — the tick that ends the run at dawn plays the dawn cue.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("Audio"): "`dawn` | `CUES.dawn` |
// The run ends at dawn", and under the table: "Each is played on the tick its
// event happens". Which tick that is, is specs/world.md ("Fallen and dawn"):
// "`DAWN_TIME` (`600`) seconds is the length of the night", and the row "Dawn |
// `tick` equals `DAWN_TIME x TICK_HZ` (`36000`). | `dawn`". So the clock is posed
// to `MAX_POSED_TICK` (`35999`), the greatest value specs/instrumentation.md's
// `setTick` accepts, and the one stepped tick after it is tick `36000` — the
// ending, and the tick that plays `dawn`.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night: every driver switch off,
// nothing alive, nothing dropped, and no slot held, so nothing hits, drops,
// collects, spawns, or fires on the ending tick and no other cue's event can
// arrive beside it. The lamplighter keeps the `BASE_MAX_HP` (`100`) a fresh run
// starts at and nothing can take any of it, so the run cannot end fallen instead;
// that ending is `audio/cue-fallen`'s.
//
// That the run ended at dawn is asserted off the run clock and the screen before
// the cue is read, so a build whose clock stopped short reports that rather than
// a missing cue.
//
// THE TOLERANCE. None: a cue sounded on the tick or it did not, the ending tick
// is a whole number the specification fixes, and a stepped frame is exactly one
// tick of specs/world.md.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { DAWN_TICK, MAX_POSED_TICK, TICK_HZ } from "../constants";
import {
  captureReplay,
  createHarness,
  watchNamedCues,
  type Harness,
} from "../harness";
import { assertHeard, openNight } from "./cues";

/** Frames recorded on the end screen, for the replay. Decides nothing. */
const TRAIL_FRAMES = TICK_HZ / 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("plays the dawn cue on the tick 36000 ends the run", async () => {
  await openNight(h);
  await h.debug.setTick(MAX_POSED_TICK);

  const cues = await watchNamedCues(h);
  const ended = await captureReplay(h, "dawn", async () => {
    const after = await h.step(1);
    const frame = h.frame();
    await h.step(TRAIL_FRAMES);
    return { after, frame };
  });

  assertEqual(
    ended.after.run.tick,
    DAWN_TICK,
    "the run clock on the ending tick",
  );
  assertEqual(ended.after.screen, "dawn", "the screen tick 36000 left");
  assertHeard(
    cues,
    ended.frame,
    "dawn",
    "the dawn cues on the tick the run ended at dawn",
  );
});
