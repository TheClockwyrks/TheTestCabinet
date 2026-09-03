// Wick — sconce/row-1: row 1 of `SCONCE_LEVELS` is in force at level 1.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Sconce"), row 1 of
// `SCONCE_LEVELS`: damage `12`, cooldown `2.0`, speed `600`, radius
// `12`, duration `2.5`, amount `1`. "A sconce is a circle of
// `radius`, launched from the player's center at `speed` along the launch
// direction `d` ... Its pierce is `INFINITE_PIERCE` ... and it is removed
// after `duration` seconds", and "Amount `n` launches `n` sconces on the same
// tick". ("Derived stats") the radius and the damage are the table value times
// `areaMul` and `damageMul`, both `1` with no passive held, and the speed,
// pierce, and duration the "table value, unchanged"; ("Cooldown timers")
// "After firing, the timer is set to the weapon's current cooldown", the table
// cooldown times a `cooldownMul` of `1`. So the firing tick creates 1 sconce
// of radius `12`, damage `12`, speed `600`, pierce `-1`, and ttl
// `2.5`, and the timer reads `2.0` after it.
//
// THE POSE. An isolated night carrying one moth on the target ring and nothing
// else, Sconce held at level 1 and fired through the shared `fireWeapon`
// (`sconce/stage.ts`): "Sconce needs at least one enemy to fire", and the ring
// stands `500` units out, beyond the whole reach of a sconce, so no target is
// touched. Every switch but `weaponFire` is held, so each sconce stands at the
// center with the figures the launch gave it and hits nothing on its own tick.
//
// TOLERANCE. `FLOAT_TOL` on the radius, the damage, and the speed; `TIMER_TOL`
// on the ttl and the timer; the count and the pierce are exact.

import { afterEach, beforeEach, it } from "vitest";
import { createHarness, type Harness } from "../harness";
import { checkSconceRow } from "./stage";

/** The level whose row is asserted. */
const LEVEL = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("fires Sconce at level 1 with row 1's figures: 1 sconce, damage 12, speed 600, radius 12, pierce -1, ttl 2.5, timer 2.0", async () => {
  await checkSconceRow(h, LEVEL);
});
