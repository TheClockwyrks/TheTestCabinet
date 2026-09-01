// audio/cue-pickup-bread — the tick on which bread is collected plays the pickup
// cue.
//
// WHERE THE THRESHOLD COMES FROM. specs/ui.md ("Audio"): "`pickup` |
// `CUES.pickup` | Bread or a draft is collected", and under the table: "Each is
// played on the tick its event happens". What collection is, is specs/world.md
// ("Collection"): a pickup is collected "on any tick on which the distance
// between its center and the lamplighter's center is less than
// `PICKUP_ITEM_RADIUS` (`16`) plus `PLAYER_RADIUS`", and "Every bread and draft
// that meets the condition on a tick is collected on that tick". So bread posed
// on the lamplighter's center, at distance `0`, is collected by the next tick,
// and that tick plays `pickup`.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night: every driver switch off,
// nothing alive, nothing else dropped, and no slot held, so the bread is the
// whole of the field and nothing else can raise a cue on the tick. The health is
// posed at POSED_HP (`50`), under the `BASE_MAX_HP` (`100`) a run with no Tallow
// held carries, so specs/world.md's "Heals `BREAD_HEAL` (`30`), capped at
// `maxHp`" shows as a rise rather than as a cap — which is what proves the
// collection happened at all, beside the emptied pickup list, before the cue is
// read. How much bread heals is `pickups/`'s point; this reads only that health
// rose.
//
// THE TOLERANCE. None: a cue sounded on the tick or it did not, and a stepped
// frame is exactly one tick of specs/world.md.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertLength } from "../assert";
import { TICK_HZ } from "../constants";
import {
  captureReplay,
  collectPickup,
  createHarness,
  player,
  watchNamedCues,
  type Harness,
} from "../harness";
import { assertHeard, openNight } from "./cues";

/** Health posed under `BASE_MAX_HP`, so the bread's heal is visible as a rise. */
const POSED_HP = 50;

/** Frames recorded after the collecting tick, for the replay. Decides nothing. */
const TRAIL_FRAMES = TICK_HZ / 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("plays the pickup cue on the tick bread is collected", async () => {
  await openNight(h);
  await h.debug.setHp(POSED_HP);

  const cues = await watchNamedCues(h);
  const taken = await captureReplay(h, "bread", async () => {
    const after = await collectPickup(h, "bread");
    const frame = h.frame();
    await h.step(TRAIL_FRAMES);
    return { after, frame };
  });

  assertLength(taken.after.run.pickups, 0, "the pickups left after the tick");
  assertGreaterThan(
    player(taken.after).hp,
    POSED_HP,
    "the lamplighter's health after the bread was collected",
  );
  assertHeard(
    cues,
    taken.frame,
    "pickup",
    "the pickup cues on the tick bread was collected",
  );
});
