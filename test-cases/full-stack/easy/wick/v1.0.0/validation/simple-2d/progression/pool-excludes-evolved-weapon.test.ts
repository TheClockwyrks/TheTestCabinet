// progression/pool-excludes-evolved-weapon — an evolved weapon is never a
// candidate, even held below no max at all.
//
// THE RULE, FROM THE SPEC. specs/progression.md, The candidate pool: "An
// evolved weapon is never a candidate, and neither is the base weapon it came
// from." specs/evolutions.md, What an evolution is, says the same of the form
// itself: "An evolved weapon has a single level and no level table ... It is
// never a level-up offer, and it is never the item a chest levels." Pyre is the
// evolution of Taper by the EVOLUTIONS table.
//
// THE POSE. An isolated night with nothing on the field and every driver switch
// off. Pyre alone is placed through setWeapon, whose level for an evolved
// weapon is "1", and which refuses "an evolved weapon whose base is held in
// another slot", so Taper is absent. Five weapon slots and every passive slot
// stay free, so the pool is large and Pyre's absence rests on the rule.
//
// THE TOLERANCE. None: an id is in the pool or it is not.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan, assertNotContains } from "../assert";
import {
  captureStill,
  createHarness,
  holdWeapon,
  isolate,
  openLevelUp,
  type Harness,
} from "../harness";

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves pyre out of the pool with Pyre held", async () => {
  isolate(h);
  holdWeapon(h, "pyre", 1);

  const overlay = await openLevelUp(h, 1);
  captureStill(h, "evolved");

  assertEqual(overlay.screen, "levelup", "the overlay the pool is read from");
  assertGreaterThan(
    overlay.run.pool.length,
    0,
    "the pool the overlay computed",
  );
  assertNotContains(overlay.run.pool, "pyre", "Pyre left out of the pool");
});
