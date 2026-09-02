// Wick — taper/amount-capped-at-two: an amount above `TAPER_MAX_AMOUNT` adds
// no slash.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Taper"): "Any amount above `TAPER_MAX_AMOUNT`
//     (`2`) adds nothing."
//   - `specs/passives.md` ("Amount"): "Taper and Pyre have two sides, so their
//     amount is capped at `TAPER_MAX_AMOUNT` (`2`) and any bonus past it adds
//     nothing", and "`amountBonus = MIRROR_AMOUNT_PER_LEVEL × mirror`" with
//     `MIRROR_AMOUNT_PER_LEVEL` `1`, so Mirror at level 2 adds 2.
//   - `specs/weapons.md` ("Taper"): the level-3 row has amount `2`, so with
//     Mirror 2 held the amount read on the firing tick is 4.
//   - `specs/instrumentation.md` (`setPassive`): "every multiplier follow[s]
//     from the next read."
//
// WHAT IS READ. The slash zones the firing tick creates: exactly 2.
//
// WHY THE NIGHT IS POSED AS IT IS. Taper alone at level 3 with Mirror at
// level 2, nothing on the field, every switch but `weaponFire` off, so the
// only zones the tick can create are the slashes, and the count is the
// firing's alone.
//
// TOLERANCE. None: a count of zones.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  MIRROR_AMOUNT_PER_LEVEL,
  TAPER_LEVELS,
  TAPER_MAX_AMOUNT,
} from "../constants";
import {
  captureStill,
  createHarness,
  holdPassive,
  zonesOfKind,
  type Harness,
} from "../harness";
import { armTaper } from "./slash";

/** The first level whose row has amount 2. */
const LEVEL = 3;

/** Mirror's top level, worth +2 amount. */
const MIRROR_LEVEL = 2;

/** The amount the firing tick reads: 2 + 2 = 4, past the cap of 2. */
const AMOUNT =
  TAPER_LEVELS[LEVEL - 1].amount + MIRROR_AMOUNT_PER_LEVEL * MIRROR_LEVEL;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("creates exactly two slashes at level 3 with Mirror 2 held", async () => {
  assertEqual(AMOUNT > TAPER_MAX_AMOUNT, true, "the posed amount past the cap");
  armTaper(h, LEVEL, "right");
  holdPassive(h, "mirror", MIRROR_LEVEL);

  const after = await h.tick(1);
  captureStill(h, "capped");

  assertEqual(
    zonesOfKind(after, "slash").length,
    TAPER_MAX_AMOUNT,
    "slashes on the firing tick at amount 4",
  );
});
