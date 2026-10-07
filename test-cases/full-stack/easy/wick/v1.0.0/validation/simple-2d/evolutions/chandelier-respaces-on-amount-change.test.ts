// Wick — evolutions/chandelier-respaces-on-amount-change: a change of amount
// replaces the set with a freshly spaced one.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/evolutions.md` ("Chandelier"): "On any tick on which `amount`
//     differs from the number of Chandelier lanterns in the world, the lanterns
//     are replaced by `amount` new zones with fresh ids and empty `hits`,
//     lantern `i` at `i × 360 / amount` degrees from the angle the lowest-id
//     lantern held."
//   - `specs/evolutions.md` ("Passives still apply"): "amount is the fixed
//     amount plus `amountBonus`"; the fixed row has amount `4`, and
//     `specs/passives.md` gives `amountBonus` as `MIRROR_AMOUNT_PER_LEVEL`
//     (`1`) per Mirror level, so Mirror at level 1 makes the amount 5 and the
//     spacing 72 degrees.
//   - `specs/instrumentation.md` (`setPassive`): "every multiplier follow[s]
//     from the next read", so the new amount is in force on the next tick;
//     (The driver switches): "Placement is gated by neither `weaponFire` nor
//     `effectMotion`".
//   - `specs/state.md` (`ZoneState`): `id` is "unique for the run, assigned
//     from `nextId`", so a lantern whose id is at least the `nextId` read
//     before the tick is one that tick created.
//
// WHAT IS READ. After the tick that follows raising Mirror to 1: five
// Chandelier lanterns, each with an id at least the `nextId` read before the
// tick and an empty `hits`, at angles 72 degrees apart starting from the angle
// the lowest-id lantern of the old set held. A build that adds one lantern to
// the live set keeps four of the old ids; one that respaces without replacing
// keeps them all.
//
// WHY THE NIGHT IS POSED AS IT IS. Chandelier alone, nothing on the field, and
// every driver switch off, `effectMotion` included, so the old set's angles are
// exactly the ones the placement gave and the angle the rule measures from is
// read rather than assumed. Mirror is the only passive held, so amount is the
// only figure that moves.
//
// TOLERANCE. `FIGURE_TOLERANCE` on each angle, an exact figure read back
// through the build's own trigonometry. None on the count, the ids, or the
// `hits`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual, assertWithin } from "../assert";
import {
  CHANDELIER_STATS,
  FIGURE_TOLERANCE,
  MIRROR_AMOUNT_PER_LEVEL,
} from "../constants";
import {
  angleAbout,
  captureStill,
  createHarness,
  holdPassive,
  normalizeDeg,
  type Harness,
} from "../harness";
import { poseEvolved } from "./evolved";
import { anglesOf, chandelierLanterns, lowestId } from "./chandelier";

/** The Mirror level held: one lantern more than the fixed amount. */
const MIRROR_LEVEL = 1;

/** The amount the placement reads after the change: 4 + 1. */
const AMOUNT = CHANDELIER_STATS.amount + MIRROR_AMOUNT_PER_LEVEL * MIRROR_LEVEL;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("replaces the four lanterns with five fresh ones spaced 72 degrees apart", async () => {
  poseEvolved(h, "chandelier");

  const placed = await h.tick(1);
  const before = chandelierLanterns(placed);
  assertEqual(
    before.length,
    CHANDELIER_STATS.amount,
    "Chandelier lanterns after the placing tick",
  );
  const anchor = angleAbout(
    placed.run.player,
    lowestId(before, "the set before the change"),
  );

  holdPassive(h, "mirror", MIRROR_LEVEL);
  const freshFrom = h.snapshot().run.nextId;

  const after = await h.tick(1);
  captureStill(h, "five");

  const set = chandelierLanterns(after);
  assertEqual(set.length, AMOUNT, "Chandelier lanterns after the change");
  for (const lantern of set) {
    assertGreaterThanOrEqual(
      lantern.id,
      freshFrom,
      `lantern ${lantern.id}: its id against the nextId before the tick, a fresh id`,
    );
    assertEqual(lantern.hits.length, 0, `lantern ${lantern.id}: hits entries`);
  }

  const expected = Array.from({ length: AMOUNT }, (_, i) =>
    normalizeDeg(anchor + (i * 360) / AMOUNT),
  ).sort((a, b) => a - b);
  anglesOf(set, after.run.player).forEach((angle, index) => {
    assertWithin(
      angle,
      expected[index],
      FIGURE_TOLERANCE,
      `the ${index + 1}th angle of the new set, ascending, measured from ${anchor} degrees`,
    );
  });
});
