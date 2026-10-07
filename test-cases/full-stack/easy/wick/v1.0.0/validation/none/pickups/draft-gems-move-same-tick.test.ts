// pickups/draft-gems-move-same-tick — gems a draft attracts fly on the tick of
// the draft.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("One tick") orders the tick:
// phase 8 pickups, "Every pickup meeting the collection condition is collected",
// then phase 9 gems, "Every gem within `pickupRadius` becomes attracted, every
// attracted gem that existed before this tick moves, and every gem within
// `COLLECT_RADIUS` is collected, this tick's drops and the gems a draft
// attracted on this tick included." The draft is collected before the gems are
// moved, and the gem it latched existed before this tick, so it takes a flight
// step on that same tick: `GEM_STEP` (`10`) units, from
// `GEM_SPEED` (`600`) `× TICK_DT` under "Attraction and flight". So a gem posed
// `POSED_DISTANCE` (`200`) units out stands `190` units out in the snapshot of
// the tick that collected the draft. A build that latches on the draft's tick
// but flies only from the next one leaves it at `200`.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night: every driver switch off,
// nothing alive, nothing else dropped, and no slot held, so nothing but the
// draft latches the gem. `POSED_DISTANCE` is far outside `PICKUP_RADIUS` (`48`),
// so the radius rule cannot latch it and the step read is the draft's, and far
// outside `COLLECT_RADIUS` (`8`) after the step, so the gem is on the field to
// be read. The gem is posed along `+x`, so the step lies along one axis. No key
// is pressed, so the lamplighter holds the origin.
//
// THE TOLERANCE. `POSITION_TOL` (`1e-6`) on the position after the step, the
// case's allowance for a position read back across a tick.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertEqual, assertNear } from "../assert";
import { GEM_STEP, POSITION_TOL } from "../constants";
import {
  captureStill,
  collectPickup,
  createHarness,
  gemById,
  isolate,
  placeGem,
  type Harness,
} from "../harness";

/** Far outside `PICKUP_RADIUS`, so only the draft can latch the gem. */
const POSED_DISTANCE = 200;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("moves a gem the draft latched GEM_STEP units on the draft's own tick", async () => {
  const opened = await isolate(h);
  const at = opened.run.player;
  const gem = await placeGem(h, "small", at.x + POSED_DISTANCE, at.y);
  assertEqual(gem.attracted, false, "the posed gem's attracted flag");

  const after = await collectPickup(h, "draft");
  await captureStill(h, "moved");

  assertEqual(after.run.pickups.length, 0, "the pickups left after the tick");
  const seen = gemById(after, gem.id);
  assertDefined(seen, "the gem after the draft's tick");
  assertNear(
    seen!.x,
    at.x + POSED_DISTANCE - GEM_STEP,
    POSITION_TOL,
    "the gem's x in the snapshot of the tick that collected the draft",
  );
  assertNear(
    seen!.y,
    at.y,
    POSITION_TOL,
    "the gem's y in the snapshot of the tick that collected the draft",
  );
});
