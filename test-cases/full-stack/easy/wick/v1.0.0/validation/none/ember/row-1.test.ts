// Wick — ember/row-1: row 1 of `EMBER_LEVELS` is in force at level 1.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Ember"), row 1 of
// `EMBER_LEVELS`: damage `10`, cooldown `1.2`, speed `400`, radius
// `8`, pierce `0`, duration `2.0`, amount `1 bolt`. "A bolt is a circle
// of `radius`, fired from the player's center at `speed` ... removed after
// `duration` seconds. Its pierce is the table `pierce`", and "With amount `n`,
// `n` bolts fire on the same tick, one at each of the `n` nearest distinct
// enemies". ("Derived stats") the radius and the damage are the table value
// times `areaMul` and `damageMul`, both `1` with no passive held, and the
// speed, pierce, and duration the "table value, unchanged"; ("Cooldown
// timers") "After firing, the timer is set to the weapon's current cooldown",
// the table cooldown times a `cooldownMul` of `1`. So with 1 moth alive
// the firing tick creates 1 bolt of radius `8`, damage `10`, speed `400`,
// pierce `0`, and ttl `2.0`, and the timer reads `1.2` after it.
//
// THE POSE. An isolated night with 1 moth on the target ring, Ember held at
// level 1 and fired through the shared `fireWeapon` (`ember/stage.ts`):
// every switch but `weaponFire` is held, so the moths stand where they were
// posed and each bolt stands at the center with the figures the firing gave
// it, hitting nothing on its own tick.
//
// TOLERANCE. `FLOAT_TOL` on the radius, the damage, and the speed; `TIMER_TOL`
// on the ttl and the timer; the count and the pierce are exact.

import { afterEach, beforeEach, it } from "vitest";
import { createHarness, type Harness } from "../harness";
import { checkEmberRow } from "./stage";

/** The level whose row is asserted. */
const LEVEL = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("fires Ember at level 1 with row 1's figures: 1 bolt, damage 10, speed 400, radius 8, pierce 0, ttl 2.0, timer 1.2", async () => {
  await checkEmberRow(h, LEVEL);
});
