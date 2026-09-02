// Wick — taper/amount-capped-at-two: an amount above `TAPER_MAX_AMOUNT` adds
// no slash.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Taper"): "With amount `2` a second slash fires on
//     the same tick, mirrored to the opposite side of the player. Any amount
//     above `TAPER_MAX_AMOUNT` (`2`) adds nothing."
//   - `specs/weapons.md` ("Amount"): "A weapon's amount is the table amount
//     plus `amountBonus`, read on the tick it fires." Row 3 of `TAPER_LEVELS`
//     carries amount 2, and `specs/passives.md`: "amountBonus =
//     MIRROR_AMOUNT_PER_LEVEL × mirror", `MIRROR_AMOUNT_PER_LEVEL` 1, so
//     Mirror at 2 makes the amount 4.
//   - `specs/instrumentation.md` (`setPassive`): "Puts passive `id` ... at
//     `level` in `slot`", Mirror's `maxLevel` being 2 (`PASSIVES`).
//
// THE DRIVE. An isolated run with no enemy, Mirror held at level 2, Taper at
// level 3 armed, and `weaponFire` the one switch on. The firing tick runs
// once and creates exactly two slashes. A build that fires one slash per
// unit of amount creates four.
//
// TOLERANCE. None: a count of zones.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  amountBonus,
  PASSIVES,
  TAPER_LEVELS,
  TAPER_MAX_AMOUNT,
} from "../constants";
import {
  advanceTicks,
  captureStill,
  createHarness,
  holdPassive,
  isolate,
  passiveLevel,
  zonesOfKind,
  type Harness,
} from "../harness";
import { armTaper } from "./slash";

/** The row under test: level 3, amount 2 before any bonus. */
const LEVEL = 3;
const ROW = TAPER_LEVELS[LEVEL - 1];

/** Mirror at its max: `+2` amount, for a total of 4. */
const MIRROR_LEVEL = PASSIVES.mirror.maxLevel;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("creates exactly two slashes at level 3 with Mirror 2 held", async () => {
  const amount = ROW.amount + amountBonus(MIRROR_LEVEL);
  if (!(amount > TAPER_MAX_AMOUNT)) {
    throw new Error("the posed amount must exceed TAPER_MAX_AMOUNT");
  }

  isolate(h);
  holdPassive(h, "mirror", MIRROR_LEVEL);
  assertEqual(
    passiveLevel(h.snapshot(), "mirror"),
    MIRROR_LEVEL,
    "Mirror's level after the pose",
  );
  armTaper(h, LEVEL);

  const after = await advanceTicks(h, 1);
  captureStill(h, "capped");

  assertEqual(
    zonesOfKind(after, "slash").length,
    TAPER_MAX_AMOUNT,
    `the slashes the firing tick created at amount ${amount}`,
  );
});
