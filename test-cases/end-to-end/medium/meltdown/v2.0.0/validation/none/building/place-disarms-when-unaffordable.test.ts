// building/place-disarms-when-unaffordable — the last affordable copy leaves
// nothing held.
//
// specs/building.md, Placing: placement "disarms only when the money left is below
// the type's cost."
//
// THE PURSE IS POSED AT EXACTLY ONE COPY. With the money at the Arc's cost the
// placement is affordable — condition 4, "at least the held type's build cost",
// holds on the nose — and the moment it is paid for the money left is 0, which is
// below the cost. So this one commit is the last affordable one, and the
// specification's disarm is due on it.
//
// THE TOWER IS CHECKED TO HAVE LANDED FIRST, because a build that refused the
// placement outright would also leave nothing armed, and that is a different
// failure than the one this item is about.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertNull } from "../assert";
import { TOWER_DEFS } from "../constants";
import { FREE_SITE } from "../fixtures";
import {
  captureStill,
  createHarness,
  startRun,
  type Harness,
} from "../harness";

/** The type armed, and the cost specs/towers.md gives it. */
const HELD = "arc";
const COST = TOWER_DEFS[HELD].cost;

/** A quiet anchor: clear of every opening and of both corridors. */
const AT = FREE_SITE;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("disarms once the money left is below the held type's cost", async () => {
  await startRun(h);
  await h.debug.setMoney(COST);

  await h.debug.setArmed(HELD);
  await h.debug.setPreview(AT.col, AT.row);
  await h.debug.place();

  const after = await h.snapshot();

  await h.advance(1);
  await captureStill(h, "disarmed");

  assertLength(after.towers, 1, "the copy the last affordable placement laid");
  assertEqual(after.money, 0, "the money left after the last affordable copy");
  assertNull(
    after.build,
    `the held preview once the money left, 0, is below the ${HELD}'s cost of ${COST}`,
  );
});
