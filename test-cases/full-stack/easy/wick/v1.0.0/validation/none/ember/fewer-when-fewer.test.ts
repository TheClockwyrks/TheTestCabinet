// Wick — ember/fewer-when-fewer: fewer bolts fire when fewer enemies exist than
// the amount.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Ember"): "With amount
// `n`, `n` bolts fire on the same tick, one at each of the `n` nearest distinct
// enemies, fewer when fewer enemies exist." Row 6 of `EMBER_LEVELS` gives
// amount `3`, and with no Lure held `amountBonus` is `0`
// (`specs/passives.md`). So with one moth alive the firing tick creates
// exactly one bolt, aimed at it.
//
// THE POSE. An isolated night with the lamplighter at the origin and one moth
// on the target ring, then Ember held at level 6 and fired through the shared
// `fireWeapon`. `enemyMotion` is held so the moth stands where it was posed on
// the firing tick, and `effectMotion` is held so the bolt stands at the center
// with the velocity the firing gave it; the moth is `200` from the bolt's
// center against a sum of radii of `18`, so nothing is hit on the firing tick.
// The moth stands off both axes, away from the facing direction (`+x` while
// facing right, `specs/weapons.md`), so the one bolt's direction is read
// against a target no default heading points at.
//
// TOLERANCE. None on the count, which is exact; `FLOAT_TOL` on the one bolt's
// direction toward the moth, so a build that fired one bolt at nothing fails
// here too.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { weaponRow } from "../constants";
import {
  alongAngle,
  captureStill,
  createHarness,
  fireWeapon,
  isolate,
  type Harness,
} from "../harness";
import {
  CENTER,
  EMBER,
  TARGET_RING,
  assertOneBoltPerTarget,
  boltsOf,
  placeMoths,
} from "./stage";

/** The level whose row carries amount `3`. */
const LEVEL = 6;

/** The one moth alive: on the target ring, off both axes. */
const MOTHS = [alongAngle(CENTER, 135, TARGET_RING)];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("fires one Ember bolt at level 6, amount 3, with one moth alive", async () => {
  assertGreaterThan(
    weaponRow(EMBER, LEVEL).amount ?? 0,
    MOTHS.length,
    "row 6's amount against the moths alive",
  );
  await isolate(h);
  await placeMoths(h, MOTHS);

  const firing = await fireWeapon(h, EMBER, LEVEL);
  await captureStill(h, "fewer");

  const bolts = boltsOf(firing);
  assertEqual(
    bolts.length,
    1,
    "Ember bolts the level-6 firing tick created with one moth alive",
  );
  assertOneBoltPerTarget(
    firing.before,
    bolts,
    MOTHS,
    "the level-6 firing over one moth",
  );
});
