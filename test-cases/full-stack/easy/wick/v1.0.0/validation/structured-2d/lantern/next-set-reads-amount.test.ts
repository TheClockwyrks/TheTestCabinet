// lantern/next-set-reads-amount — the firing after a Mirror gain reads the new
// amount.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Lantern"): "A set is
// fixed when it is created: a Mirror level gained while a set lives leaves
// that set's count as it is, and the next firing reads the new amount." And
// ("Amount"): "A weapon's amount is the table amount plus `amountBonus`, read
// on the tick it fires. It counts the projectiles, puddles, strikes, or
// lanterns one firing produces." `specs/passives.md` gives
// `amountBonus = MIRROR_AMOUNT_PER_LEVEL × mirror` with
// `MIRROR_AMOUNT_PER_LEVEL` (`1`), so at Mirror 1 the bonus is 1. Row 1 of the
// level table gives amount 1, so the firing after the gain creates 1 + 1 = 2
// lanterns.
//
// WHEN THE NEXT FIRING FALLS. `specs/weapons.md` ("Lantern"): "On firing,
// Lantern's cooldown timer is set to `duration` plus the current cooldown",
// 3.0 + 3.0 = 6.0 at row 1, which `specs/world.md` ("Timers") makes
// `round(6.0 × 60)` = 360 ticks after the first firing; the first set is gone
// on tick 180. The check sweeps to the tick a lantern stands again rather than
// stepping to 360 blind, so a build whose gap is a few ticks off still has its
// AMOUNT graded here and fails the gap on the check that decides it. The
// budget is a hundred ticks past 360, and a sweep that never finds a set
// fails the item.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run holding nothing but Lantern
// at level 1, `weaponFire` on throughout since the second firing is the whole
// point. Mirror 1 is placed while the first set is alive, at tick 1 of the
// wait, so the gain is genuinely mid-set and the second firing is the first
// read of the new amount. The second set is identified by id — every zone it
// holds was created after the first firing — so a build that kept the first
// set standing cannot be counted as the second.
//
// THE TOLERANCE. None: the requirement is a count of zones.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import { LANTERN_LEVELS, MIRROR_AMOUNT_PER_LEVEL, ticksOf } from "../constants";
import {
  captureStill,
  createHarness,
  holdPassive,
  type Harness,
} from "../harness";
import { fireLantern, lanternsCreatedSince, lanternsOf } from "./set";

/** Row 1 of Lantern: amount 1, duration 3.0, cooldown 3.0. */
const LEVEL = 1;
const ROW = LANTERN_LEVELS[LEVEL - 1];

/** The Mirror level gained mid-set. */
const MIRROR = 1;

/** What the firing after the gain must create: table amount plus the bonus. */
const EXPECTED = ROW.amount + MIRROR_AMOUNT_PER_LEVEL * MIRROR;

/** When the next firing is due: `round((3.0 + 3.0) × 60)` = 360 ticks out. */
const NEXT = ticksOf(ROW.duration + ROW.cooldown);

/** How far the sweep for the next set may run. */
const BUDGET = NEXT + 100;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("creates two lanterns on the firing after Mirror 1 was gained during a level-1 set", async () => {
  const firing = await fireLantern(h, LEVEL);
  assertEqual(
    firing.lanterns.length,
    ROW.amount,
    `the lanterns the first firing created at level ${LEVEL} (specs/weapons.md, Lantern)`,
  );

  await h.tick(1);
  holdPassive(h, "mirror", MIRROR);
  assertEqual(
    lanternsOf(h.snapshot()).length,
    ROW.amount,
    "the lanterns standing when Mirror was gained, which makes the gain mid-set",
  );

  const swept = await h.until(
    (s) => lanternsCreatedSince(firing.after, s).length > 0,
    { maxTicks: BUDGET },
  );
  captureStill(h, "next");

  assertTrue(
    swept.hit,
    `whether a second set arrived within ${BUDGET} ticks of the first firing, the next firing being due at ${NEXT} (specs/weapons.md, Lantern)`,
  );
  assertEqual(
    lanternsCreatedSince(firing.after, swept.snapshot).length,
    EXPECTED,
    `the lanterns the firing after the Mirror gain created (specs/weapons.md, Lantern and Amount)`,
  );
});
