// Wick — evolutions/pyre-amount-capped: Pyre's amount is capped at
// `TAPER_MAX_AMOUNT`.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("Pyre"): "Its amount
// is `2` plus `amountBonus`, capped at `TAPER_MAX_AMOUNT` (`2`), so both sides
// always fire and nothing more." `specs/passives.md` ("Amount"): "`amountBonus
// = MIRROR_AMOUNT_PER_LEVEL × mirror`", `1` per level, and "Taper and Pyre have
// two sides, so their amount is capped at `TAPER_MAX_AMOUNT` (`2`) and any
// bonus past it adds nothing." Mirror's max level is `2` (`specs/passives.md`),
// so the amount in force is `2 + 2 = 4` and the firing tick creates exactly `2`
// slash zones.
//
// THE POSE. An isolated night with Mirror held at level 2 through `setPassive`
// and Pyre held at level 1 fired through the shared `fireWeapon`. No enemy is
// posed: the reading is the count of Pyre slashes among the zones the tick
// created, told by id from the `nextId` the run held before it.
//
// TOLERANCE. None: the count is exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { PASSIVES, TAPER_MAX_AMOUNT, weaponRow } from "../constants";
import {
  captureStill,
  createHarness,
  fireWeapon,
  holdPassive,
  isolate,
  type Harness,
} from "../harness";
import { zonesFired } from "./stage";

/** Mirror at its max level, `2`, for an `amountBonus` of `2` on top of Pyre's `2`. */
const MIRROR_LEVEL = PASSIVES.mirror.maxLevel;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("creates exactly two Pyre slash zones with Mirror 2 held, an amount of four", async () => {
  assertEqual(weaponRow("pyre").amount, TAPER_MAX_AMOUNT, "PYRE_STATS' amount");
  await isolate(h);
  await h.debug.setFacing("right");
  await holdPassive(h, "mirror", MIRROR_LEVEL);

  const firing = await fireWeapon(h, "pyre", 1);
  await captureStill(h, "capped");

  assertEqual(
    zonesFired(firing, "pyre", "slash").length,
    TAPER_MAX_AMOUNT,
    "Pyre slash zones the firing tick created at an amount of 4",
  );
});
