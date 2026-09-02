// audio/cue-fallen — the tick that ends the run with health at or below 0 plays
// the fallen cue.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("Audio"): "`fallen` |
// `CUES.fallen` | The run ends fallen", and under the table: "Each is played on
// the tick its event happens". What ends a run fallen is specs/world.md ("Fallen
// and dawn"): "A run ends at the end of a tick, after every other phase of that
// tick has been applied", by the row "Fallen | `hp` is `0` or below. |
// `fallen`". specs/instrumentation.md says the same of the pose that reaches it:
// `setHp(hp)` takes "a real number at most `maxHp`", and "A value at or below `0`
// ends the run fallen at the end of the next `playing` tick". So health posed at
// FALLEN_HP (`0`) and one stepped tick is the ending, and that tick plays
// `fallen`.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night: every driver switch off,
// nothing alive, nothing dropped, and no slot held, so nothing hits, drops,
// collects, or fires on the ending tick and no other cue's event can arrive
// beside it. `recovery` is `BASE_RECOVERY` (`0`) with no Tinder held, so the
// recovery phase specs/world.md runs before contact leaves the posed health where
// it was put. The run clock is far from `DAWN_TICK` (`36000`), so the ending is
// the fallen one rather than dawn, which specs/world.md checks first and which
// `audio/cue-dawn` reads.
//
// That the run ended is asserted off the screen before the cue is read, so a
// build that stayed on `playing` reports that rather than a missing cue.
//
// THE TOLERANCE. None: a cue sounded on the tick or it did not, and a stepped
// frame is exactly one tick of specs/world.md.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import { TICK_HZ } from "../constants";
import {
  captureReplay,
  createHarness,
  player,
  watchNamedCues,
  type Harness,
} from "../harness";
import { assertHeard, openNight } from "./cues";

/** The health posed: the boundary specs/world.md ends a run at, "`0` or below". */
const FALLEN_HP = 0;

/** Frames recorded on the end screen, for the replay. Decides nothing. */
const TRAIL_FRAMES = TICK_HZ / 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("plays the fallen cue on the tick health at 0 ends the run", async () => {
  await openNight(h);
  await h.debug.setHp(FALLEN_HP);

  const cues = await watchNamedCues(h);
  const ended = await captureReplay(h, "fallen", async () => {
    const after = await h.step(1);
    const frame = h.frame();
    await h.step(TRAIL_FRAMES);
    return { after, frame };
  });

  assertEqual(ended.after.screen, "fallen", "the screen the ending tick left");
  assertLessThanOrEqual(
    player(ended.after).hp,
    FALLEN_HP,
    "the lamplighter's health on the ending tick",
  );
  assertHeard(
    cues,
    ended.frame,
    "fallen",
    "the fallen cues on the tick the run ended fallen",
  );
});
