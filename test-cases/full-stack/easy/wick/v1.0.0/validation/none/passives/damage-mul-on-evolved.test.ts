// Wick — passives/damage-mul-on-evolved: an evolved weapon's fixed damage
// passes through `damageMul` as a table row does.
//
// WHERE THE THRESHOLD COMES FROM. `specs/passives.md`: "The formulas apply to
// every weapon alike, base and evolved. An evolved weapon's single stat row
// passes through damageMul, cooldownMul, areaMul, and amountBonus exactly as a
// base weapon's table row does", over
// "`damageMul = 1 + WICK_DAMAGE_PER_LEVEL × wick`" with
// `WICK_DAMAGE_PER_LEVEL` (`0.1`). `specs/evolutions.md` ("Passives still
// apply") repeats it: "damage is the fixed damage times `damageMul`".
// `BEACON_STATS` carries damage `20`, so with Wick at level 2 a Beacon bolt
// reads `20 × 1.2 = 24`.
//
// THE POSE. An isolated night with Wick 2 held through `setPassive` and Beacon
// held at its single level and fired by one tick. Beacon "needs at least one
// enemy to fire", so one hound stands `FAR` (`5000`) units along `+x`, past
// every reach a bolt has, and every other faculty stays held, so nothing
// travels and nothing else fires. The reading is the damage per hit the bolt
// carries, which `specs/instrumentation.md` ("Snapshot shape") reports as
// `damage`.
//
// TOLERANCE. `FLOAT_TOL` on the damage, a fixed figure times exactly `1.2`. The
// unscaled `20` is four whole units away.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { FLOAT_TOL, damageMul, weaponRow } from "../constants";
import {
  captureStill,
  createHarness,
  fireWeapon,
  holdPassive,
  isolate,
  type Harness,
} from "../harness";
import { placeFarTarget } from "./stage";

/** The Wick level held: `damageMul` `1.2`. */
const WICK_LEVEL = 2;

/** `20 × (1 + 0.1 × 2)`. */
const EXPECTED = weaponRow("beacon").damage * damageMul({ wick: WICK_LEVEL });

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("reads damage 24 on a Beacon bolt with Wick 2 held", async () => {
  await isolate(h);
  await holdPassive(h, "wick", WICK_LEVEL);
  await placeFarTarget(h, "hound");

  const firing = await fireWeapon(h, "beacon");
  await captureStill(h, "evolved");

  const bolts = firing.projectiles.filter((shot) => shot.weapon === "beacon");
  assertEqual(bolts.length, 1, "Beacon bolts the firing tick created");
  assertNear(
    bolts[0]!.damage,
    EXPECTED,
    FLOAT_TOL,
    "the Beacon bolt's damage per hit with Wick 2 held",
  );
});
