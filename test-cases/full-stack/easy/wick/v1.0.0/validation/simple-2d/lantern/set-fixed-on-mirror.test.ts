// Wick — lantern/set-fixed-on-mirror: a Mirror level gained while a set lives
// leaves that set's count as it is.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Lantern"): "A set is fixed when it is created: a
//     Mirror level gained while a set lives leaves that set's count as it is,
//     and the next firing reads the new amount"; row 1 has amount `1`.
//   - `specs/weapons.md` ("Amount"): "A weapon's amount is the table amount
//     plus `amountBonus`, read on the tick it fires", and
//     `specs/passives.md`: Mirror gives `MIRROR_AMOUNT_PER_LEVEL` (`1`) per
//     level, so the amount a Mirror level would give the NEXT set is `2`.
//   - `specs/instrumentation.md` (`setPassive`): "every multiplier follow[s]
//     from the next read", so the passive is in force on every tick after
//     the pose; and (The driver switches): the placement part of phase 5
//     "runs on every `playing` tick", which is the phase that could re-read
//     a set.
//
// WHAT IS READ. With Mirror raised to `1` on the tick after a level-1 set was
// created, the Lantern lanterns in the world after each of the 179 ticks that
// remain of that set's life: exactly the one the firing created, by id, on
// every one of them. A build that re-reads amount for a live set shows two.
//
// WHY THE NIGHT IS POSED AS IT IS. Lantern alone at level 1, one lantern, so
// any second one is Mirror's doing; nothing on the field; every switch off
// but `weaponFire`, which the firing needs; the span ends on the last tick
// before the set's `ttl` of `3.0` is due, `round(3.0 × 60) − 1` ticks after
// the firing, so every reading is of the set created before Mirror, and
// Lantern's timer of `6.0` outlasts the span, so no second firing joins it;
// `effectMotion` off holds the lantern where it was placed.
//
// TOLERANCE. None: the reading is a count and an id.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual, assertEqual } from "../assert";
import { ticksFor } from "../constants";
import {
  captureStill,
  createHarness,
  holdPassive,
  type Harness,
} from "../harness";
import { armLantern, lanternRow, lanternsOf } from "./orbit";

/** The level this point holds Lantern at: one lantern. */
const LEVEL = 1;

/** Row 1 of LANTERN_LEVELS. */
const ROW = lanternRow(LEVEL);

/** The Mirror level gained while the set lives. */
const MIRROR_LEVEL = 1;

/** The tick after the firing the set's ttl is due on: round(3.0 × 60). */
const DUE_TICK = ticksFor(ROW.duration);

/** The ticks watched after Mirror rises: the rest of the set's life. */
const WATCH_TICKS = DUE_TICK - 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("keeps the level-1 set at one lantern after Mirror rises to 1", async () => {
  assertEqual(ROW.amount, 1, "the level-1 row's amount");
  armLantern(h, LEVEL);
  const fired = await h.tick(1);
  const created = lanternsOf(fired).map((lantern) => lantern.id);
  assertEqual(created.length, ROW.amount, "Lantern lanterns after the firing");

  holdPassive(h, "mirror", MIRROR_LEVEL);
  const seen = await h.trace(WATCH_TICKS);
  captureStill(h, "fixed");

  const last = seen[WATCH_TICKS - 1];
  assertEqual(
    last.run.passives.some(
      (held) => held.id === "mirror" && held.level === MIRROR_LEVEL,
    ),
    true,
    "Mirror held at level 1 while the set lives",
  );
  seen.forEach((snapshot, index) => {
    assertDeepEqual(
      lanternsOf(snapshot).map((lantern) => lantern.id),
      created,
      `the Lantern lanterns after tick ${index + 2} of the set's life, by id`,
    );
  });
});
