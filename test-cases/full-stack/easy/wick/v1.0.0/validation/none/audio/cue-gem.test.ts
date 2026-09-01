// audio/cue-gem — the tick on which a gem is collected plays the gem cue.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("Audio"): "`gem` | `CUES.gem` | A
// gem is collected. At most once per tick", and under the table: "Each is played
// on the tick its event happens". What collection is, is specs/world.md
// ("Attraction and flight"): "a gem whose center is at most `COLLECT_RADIUS` from
// the lamplighter's center is collected on that tick: it is removed, and `xp`
// rises by `GEM_VALUES[tier] x xpMul`". So one gem posed on the lamplighter's
// center, at distance `0`, is collected by the next tick, and that tick plays
// `gem`.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night: every driver switch off,
// nothing alive, nothing else dropped, and no slot held, so the gem is the whole
// of the field and no other event can raise a cue beside it. The gem is a `small`
// one, worth `GEM_VALUES.small` (`1`) experience, and `isolate` holds the run at
// level `50`, where `xpToNext(50)` is `495`: one point of experience opens no
// level-up overlay, so the tick raises `gem` and nothing else. That the gem was
// collected at all is asserted off the empty gem list and the risen experience
// before the cue is read.
//
// THE TOLERANCE. None: a cue sounded on the tick or it did not, and a stepped
// frame is exactly one tick of specs/world.md.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertLength } from "../assert";
import { TICK_HZ } from "../constants";
import {
  captureReplay,
  collectGem,
  createHarness,
  watchNamedCues,
  type Harness,
} from "../harness";
import { assertHeard, openNight } from "./cues";

/** Frames recorded after the collecting tick, for the replay. Decides nothing. */
const TRAIL_FRAMES = TICK_HZ / 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("plays the gem cue on the tick a gem is collected", async () => {
  const opened = await openNight(h);

  const cues = await watchNamedCues(h);
  const taken = await captureReplay(h, "gem", async () => {
    const after = await collectGem(h, "small");
    const frame = h.frame();
    await h.step(TRAIL_FRAMES);
    return { after, frame };
  });

  assertLength(taken.after.run.gems, 0, "the gems left after the tick");
  assertGreaterThan(
    taken.after.run.xp,
    opened.run.xp,
    "the experience the collection added",
  );
  assertEqual(taken.after.screen, "playing", "the screen the collection left");
  assertHeard(
    cues,
    taken.frame,
    "gem",
    "the gem cues on the tick the gem was collected",
  );
});
