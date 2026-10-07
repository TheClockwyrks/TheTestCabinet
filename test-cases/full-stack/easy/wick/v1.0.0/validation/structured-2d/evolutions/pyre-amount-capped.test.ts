// evolutions/pyre-amount-capped — Pyre's amount caps at TAPER_MAX_AMOUNT.
//
// WHERE THE THRESHOLD COMES FROM. `specs/evolutions.md` ("Pyre"): "Its amount
// is `2` plus `amountBonus`, capped at `TAPER_MAX_AMOUNT` (`2`), so both sides
// always fire and nothing more." `specs/passives.md` ("Amount"): "amountBonus
// = MIRROR_AMOUNT_PER_LEVEL × mirror" with `MIRROR_AMOUNT_PER_LEVEL` (`1`),
// and "Taper and Pyre have two sides, so their amount is capped at
// `TAPER_MAX_AMOUNT` (`2`) and any bonus past it adds nothing." Mirror's max
// level is 2 (`PASSIVES`), so Mirror 2 makes the amount `2 + 2` = 4 before the
// cap, and the firing tick still creates exactly two slashes.
//
// WHY MIRROR IS HELD AT ITS MAX. It is the largest bonus the game can put on
// the weapon, so a build that fires one slash per unit of amount creates four
// here rather than three, and one that capped at the wrong figure is as
// visible.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run with no enemy, Mirror held
// at 2, Pyre armed, and `weaponFire` the one switch on. Mirror is read back
// before the firing, so a surface that did not place it fails there rather
// than on a count that was never at risk.
//
// THE TOLERANCE. None: a count of zones.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  PASSIVES,
  PYRE_STATS,
  TAPER_MAX_AMOUNT,
  amountBonus,
} from "../constants";
import {
  captureStill,
  createHarness,
  holdPassive,
  isolate,
  passiveLevel,
  zonesOfKind,
  type Harness,
} from "../harness";
import { fireFromPosed } from "./evolved";

/** Mirror at its max: an amount bonus of 2, for a total of 4 before the cap. */
const MIRROR_LEVEL = PASSIVES.mirror.maxLevel;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("creates exactly two slashes with Mirror 2 held", async () => {
  const amount = PYRE_STATS.amount + amountBonus(MIRROR_LEVEL);
  if (!(amount > TAPER_MAX_AMOUNT)) {
    throw new Error("the posed amount must exceed TAPER_MAX_AMOUNT");
  }

  isolate(h);
  holdPassive(h, "mirror", MIRROR_LEVEL);
  assertEqual(
    passiveLevel(h.snapshot(), "mirror"),
    MIRROR_LEVEL,
    "Mirror's level after the pose (specs/instrumentation.md, setPassive)",
  );

  const firing = await fireFromPosed(h, "pyre");
  captureStill(h, "capped");

  assertEqual(
    zonesOfKind(firing.after, "slash").length,
    TAPER_MAX_AMOUNT,
    `the slashes the firing tick created at an amount of ${amount} (specs/evolutions.md, Pyre)`,
  );
});
