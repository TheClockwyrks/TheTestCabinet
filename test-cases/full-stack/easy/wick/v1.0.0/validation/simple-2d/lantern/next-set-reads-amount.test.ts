// Wick — lantern/next-set-reads-amount: the firing after a set that lived
// through a Mirror gain reads the new amount.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Lantern"): "A set is fixed when it is created: a
//     Mirror level gained while a set lives leaves that set's count as it is,
//     and the next firing reads the new amount"; row 1 has amount `1`.
//   - `specs/weapons.md` ("Amount"): "A weapon's amount is the table amount
//     plus `amountBonus`, read on the tick it fires", and
//     `specs/passives.md`: `amountBonus` is `MIRROR_AMOUNT_PER_LEVEL` (`1`)
//     per Mirror level, so the next set at level 1 with Mirror 1 has `2`
//     lanterns.
//   - `specs/weapons.md` ("Lantern"): "On firing, Lantern's cooldown timer
//     is set to `duration` plus the current cooldown ... so the timer is due
//     once the set has been gone for the cooldown", so the next firing
//     follows the set's vanishing; `specs/state.md` (`ZoneState.id`): ids
//     are "unique for the run, assigned from `nextId`", which tells the next
//     set from the first.
//
// WHAT IS READ. The Lantern lanterns whose ids the first firing did not
// create, on the first tick any such lantern appears: exactly `2`. The tick
// it appears on is the timer point's concern, so the sweep runs to twice the
// stated period and fails only if no next set ever comes.
//
// WHY THE NIGHT IS POSED AS IT IS. Lantern alone at level 1 with Mirror
// gained through `setPassive` after the first firing, while the set lives;
// nothing on the field; every switch off but `weaponFire`, so the only
// firings are Lantern's and the only zones lanterns; `effectMotion` off
// holds the lanterns still, which the amount never reads.
//
// TOLERANCE. None: the reading is a count.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { derived, ticksFor } from "../constants";
import {
  captureStill,
  createHarness,
  holdPassive,
  type Harness,
  type WickSnapshot,
} from "../harness";
import { armLantern, lanternRow, lanternsOf, timerAfterFiring } from "./orbit";

/** The level this point holds Lantern at: one lantern. */
const LEVEL = 1;

/** Row 1 of LANTERN_LEVELS. */
const ROW = lanternRow(LEVEL);

/** The Mirror level gained while the first set lives. */
const MIRROR_LEVEL = 1;

/** The count the next set has: the row's amount plus Mirror's bonus, 2. */
const NEXT_AMOUNT = ROW.amount + derived.amountBonus({ mirror: MIRROR_LEVEL });

/** How far the sweep for the next set runs: twice the stated period. */
const SWEEP_TICKS = 2 * ticksFor(timerAfterFiring(ROW));

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("creates two lanterns on the firing after a level-1 set that lived through a Mirror gain", async () => {
  assertEqual(ROW.amount, 1, "the level-1 row's amount");
  armLantern(h, LEVEL);
  const fired = await h.tick(1);
  const created = new Set(lanternsOf(fired).map((lantern) => lantern.id));
  assertEqual(created.size, ROW.amount, "Lantern lanterns after the firing");
  holdPassive(h, "mirror", MIRROR_LEVEL);

  const fresh = (snapshot: WickSnapshot): number[] =>
    lanternsOf(snapshot)
      .map((lantern) => lantern.id)
      .filter((id) => !created.has(id));
  const next = await h.until((snapshot) => fresh(snapshot).length > 0, {
    maxTicks: SWEEP_TICKS,
  });
  captureStill(h, "next");

  assertEqual(
    next.hit,
    true,
    `whether a next set appeared within ${SWEEP_TICKS} ticks of the first firing`,
  );
  assertEqual(
    fresh(next.snapshot).length,
    NEXT_AMOUNT,
    `the lanterns of the next set, on tick ${next.ticks + 1} after the first firing`,
  );
});
