// Wick — passives/amount-bonus-on-evolved: an evolved weapon's fixed amount
// takes `amountBonus` as a table row does.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md`: "The formulas apply to
// every weapon alike, base and evolved. An evolved weapon's single stat row
// passes through damageMul, cooldownMul, areaMul, and amountBonus exactly as a
// base weapon's table row does", over
// "`amountBonus = MIRROR_AMOUNT_PER_LEVEL × mirror`" with
// `MIRROR_AMOUNT_PER_LEVEL` (`1`), and ("Amount") "The weapons whose stat row
// carries an `amount` all take the bonus, Beacon, Hail, Chandelier, and Blaze
// included." `BLAZE_STATS` carries amount `5`, so with Mirror at level 1 a
// firing creates `6` puddles.
//
// THE POSE. An isolated night with Mirror 1 held through `setPassive` and Blaze
// held at its single level and fired by one tick. Blaze "fires whether or not
// any enemy exists", so no enemy is posed; each puddle lands at a random point
// of the scatter disk, which the reading does not touch. Every other faculty
// stays held, so nothing else fires.
//
// TOLERANCE. None: the count of puddles one tick created is exact.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { amountBonus, weaponRow } from "../constants";
import {
  captureStill,
  createHarness,
  fireWeapon,
  holdPassive,
  isolate,
  type Harness,
} from "../harness";

/** The Mirror level held: `amountBonus` `1`. */
const MIRROR_LEVEL = 1;

/** `5 + 1`. */
const EXPECTED =
  (weaponRow("blaze").amount ?? NaN) + amountBonus({ mirror: MIRROR_LEVEL });

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("creates six Blaze puddles on one firing with Mirror 1 held", async () => {
  await isolate(h);
  await holdPassive(h, "mirror", MIRROR_LEVEL);

  const firing = await fireWeapon(h, "blaze");
  await captureStill(h, "evolved");

  const puddles = firing.zones.filter((zone) => zone.weapon === "blaze");
  assertEqual(
    puddles.length,
    EXPECTED,
    "Blaze puddles the firing tick created with Mirror 1 held",
  );
});
