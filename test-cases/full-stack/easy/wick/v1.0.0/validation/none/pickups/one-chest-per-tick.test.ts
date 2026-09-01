// pickups/one-chest-per-tick — one chest is collected per tick.
//
// WHERE THE THRESHOLD COMES FROM. specs/world.md ("Collection"): "Of the chests
// that meet it on one tick, the one with the lowest `id` alone is collected, and
// the others wait for the next `playing` tick." specs/instrumentation.md fixes
// which id is the lower: "A pose that creates an entity gives it the next id
// from `nextId`", so the chest posed first carries it. specs/progression.md
// ("The chest overlay") gives the way back to `playing`: "`confirm` closes it,
// setting `chestResult` to `null` and `screen` to `playing`", which
// `setScreen("playing")` from `chest` does "exactly as `confirm` does". So with
// two chests on the lamplighter's center, the first tick takes the lower id
// alone and leaves the other standing, and the first `playing` tick after the
// overlay closes takes that one.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night: every driver switch off,
// nothing alive, nothing else dropped, and no slot held, so the two chests are
// the only pickups in the world and nothing else opens an overlay. Both are
// posed on the lamplighter's center, at distance `0`, so both meet the
// collection condition on the same tick, which is the only way the one-per-tick
// rule can be read at all. `isolate` poses `ISOLATE_LEVEL` (`50`) and no gem is
// on the field, so no level-up competes for the end of either tick.
//
// THE TOLERANCE. None: pickup ids and counts and a screen name are exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertEqual, assertLessThan } from "../assert";
import {
  captureStill,
  createHarness,
  isolate,
  pickupById,
  placePickup,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("collects the lower-id chest alone, and the other on the next playing tick", async () => {
  const opened = await isolate(h);
  const at = opened.run.player;
  const first = await placePickup(h, "chest", at.x, at.y);
  const second = await placePickup(h, "chest", at.x, at.y);
  assertLessThan(first.id, second.id, "the id of the chest posed first");

  const afterFirst = await h.step(1);
  await captureStill(h, "one");

  assertEqual(afterFirst.screen, "chest", "the screen the first tick left");
  assertEqual(
    afterFirst.run.pickups.length,
    1,
    "the chests left after the first tick",
  );
  const waiting = pickupById(afterFirst, second.id);
  assertDefined(waiting, "the higher-id chest after the first tick");

  await h.debug.setScreen("playing");
  const afterSecond = await h.step(1);

  assertEqual(
    afterSecond.run.pickups.length,
    0,
    "the chests left after the next playing tick",
  );
  assertEqual(
    afterSecond.screen,
    "chest",
    "the screen the next playing tick left",
  );
});
