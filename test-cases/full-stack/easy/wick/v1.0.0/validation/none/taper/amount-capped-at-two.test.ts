// Wick — taper/amount-capped-at-two: amount above `TAPER_MAX_AMOUNT` adds
// nothing.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Taper"): "Any amount
// above `TAPER_MAX_AMOUNT` (`2`) adds nothing." ("Amount"): "A weapon's amount
// is the table amount plus `amountBonus`, read on the tick it fires", and
// `specs/passives.md` gives `amountBonus = MIRROR_AMOUNT_PER_LEVEL × mirror`,
// `1` per level, with "Taper and Pyre have two sides, so their amount is
// capped at `TAPER_MAX_AMOUNT` (`2`) and any bonus past it adds nothing." Row 3
// of `TAPER_LEVELS` carries amount `2`, and Mirror at its max level `2` adds
// `2`, so the amount in force is `4` and the firing tick creates exactly `2`
// slash zones.
//
// THE POSE. An isolated night, Mirror held at level 2 through `setPassive`,
// and Taper held at level 3 fired by one tick (`taper/stage.ts`). No moth is
// needed: the reading is the count of Taper slashes among the zones the tick
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
import { slashesOf } from "./stage";

/** The first level whose row carries amount `2`. */
const LEVEL = 3;

/** Mirror at its max level, `2`, for a bonus of `2` on top. */
const MIRROR_LEVEL = PASSIVES.mirror.maxLevel;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("creates exactly two slash zones at table amount 2 with Mirror 2 held", async () => {
  assertEqual(weaponRow("taper", LEVEL).amount, 2, "row 3's table amount");
  await isolate(h);
  await h.debug.setFacing("right");
  await holdPassive(h, "mirror", MIRROR_LEVEL);

  const firing = await fireWeapon(h, "taper", LEVEL);
  await captureStill(h, "capped");

  assertEqual(
    slashesOf(firing).length,
    TAPER_MAX_AMOUNT,
    "Taper slash zones the firing tick created at an amount of 4",
  );
});
