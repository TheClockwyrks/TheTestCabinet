// Wick — evolutions/pyre-amount-capped: an amount above `TAPER_MAX_AMOUNT`
// adds no slash to a Pyre firing.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/evolutions.md` ("Pyre"): "Its amount is `2` plus `amountBonus`,
//     capped at `TAPER_MAX_AMOUNT` (`2`), so both sides always fire and nothing
//     more."
//   - `specs/passives.md` ("Amount"): "Taper and Pyre have two sides, so their
//     amount is capped at `TAPER_MAX_AMOUNT` (`2`) and any bonus past it adds
//     nothing", and `amountBonus` is `MIRROR_AMOUNT_PER_LEVEL` (`1`) per Mirror
//     level, so Mirror at its `maxLevel` of `2` gives a bonus of 2 and the
//     amount read on the firing tick is 4.
//   - `specs/instrumentation.md` (`setPassive`): "`hp` is untouched; `maxHp`,
//     `armor`, `moveSpeed`, `pickupRadius`, and every multiplier follow from
//     the next read", so Mirror is in force on the firing tick.
//   - `specs/state.md` (`ZoneKind`): a slash is a zone of kind `slash`.
//
// WHAT IS READ. The slash zones the firing tick creates with Mirror 2 held:
// exactly 2. A build that reads the bonus into Pyre without the cap creates
// four.
//
// WHY THE NIGHT IS POSED AS IT IS. Pyre alone with Mirror at level 2 the only
// passive, nothing on the field, every driver switch but `weaponFire` off, so
// the only zones the tick can create are the slashes and the count is the
// firing's alone. Mirror changes `amountBonus` and nothing else, so no other
// figure of the firing moves.
//
// TOLERANCE. None: a count of zones.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  MIRROR_AMOUNT_PER_LEVEL,
  PASSIVES,
  PYRE_STATS,
  TAPER_MAX_AMOUNT,
} from "../constants";
import {
  captureStill,
  createHarness,
  holdPassive,
  zonesOfKind,
  type Harness,
} from "../harness";
import { armEvolved } from "./evolved";

/** Mirror at its top level: an `amountBonus` of 2. */
const MIRROR_LEVEL = PASSIVES.mirror.maxLevel;

/** The amount the firing tick reads: 2 + 2 = 4, past the cap of 2. */
const AMOUNT = PYRE_STATS.amount + MIRROR_AMOUNT_PER_LEVEL * MIRROR_LEVEL;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("creates exactly two slashes with Mirror 2 held", async () => {
  assertEqual(AMOUNT > TAPER_MAX_AMOUNT, true, "the posed amount past the cap");
  armEvolved(h, "pyre", { facing: "right" });
  holdPassive(h, "mirror", MIRROR_LEVEL);

  const after = await h.tick(1);
  captureStill(h, "capped");

  assertEqual(
    zonesOfKind(after, "slash").length,
    TAPER_MAX_AMOUNT,
    "slash zones on the firing tick at amount 4",
  );
});
