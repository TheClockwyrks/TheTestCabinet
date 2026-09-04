// building/place-disarms-when-unaffordable — the last affordable copy leaves
// nothing held.
//
// specs/building.md, Placing: placement "disarms only when the money left is
// below the type's cost."
//
// THE PURSE IS POSED AT EXACTLY ONE COPY. With the money at the Arc's cost the
// placement is affordable — condition 4 holds on the nose — and the moment it is
// paid for the money left is 0, which is below the cost. So this one commit is
// the last affordable one, and the specification's disarm is due on it.
//
// The tower is checked to have landed first, because a build that refused the
// placement outright would also leave nothing armed, and that is a different
// failure than the one this item is about.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNull } from "../assert";
import { TOWER_DEFS } from "../constants";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";

/** The type armed, and the cost specs/towers.md gives it. */
const HELD = "arc";
const COST = TOWER_DEFS[HELD].cost;

/** Open floor clear of the four openings. */
const COL = 10;
const ROW = 8;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("disarms once the money left is below the held type's cost", async () => {
  startRun(h);
  h.debug.setMoney(COST);

  h.debug.setArmed(HELD);
  h.debug.setPreview(COL, ROW);
  h.debug.place();

  const after = h.snapshot();

  await h.advance(1);
  captureStill(h, "disarmed");

  assertLength(after.towers, 1, "the copy the last affordable placement laid");
  assertEqual(after.money, 0, "the money left after the last affordable copy");
  assertNull(
    after.build,
    `the held preview once the money left, 0, is below the ${HELD}'s cost of ${COST}`,
  );
});
