// Wick — sconce/row-4: row 4 of `SCONCE_LEVELS` is in force at level 4.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Sconce"), row 4 of
// `SCONCE_LEVELS`: damage `16`, cooldown `1.8`, speed `600`, radius
// `14`, duration `2.5`, amount `2`. "A sconce is a circle of
// `radius`, launched from the player's center at `speed` along the launch
// direction `d` ... Its pierce is `INFINITE_PIERCE` ... and it is removed
// after `duration` seconds", and "Amount `n` launches `n` sconces on the same
// tick". ("Derived stats") the radius and the damage are the table value times
// `areaMul` and `damageMul`, both `1` with no passive held, and the speed,
// pierce, and duration the "table value, unchanged"; ("Cooldown timers")
// "After firing, the timer is set to the weapon's current cooldown", the table
// cooldown times a `cooldownMul` of `1`. So the firing tick creates 2 sconces
// of radius `14`, damage `16`, speed `600`, pierce `-1`, and ttl
// `2.5`, and the timer reads `1.8` after it.
//
// THE POSE. An isolated night carrying 2 moths on the target ring and nothing
// else, Sconce held at level 4 and fired through the shared `fireWeapon`
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
const LEVEL = 4;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("fires Sconce at level 4 with row 4's figures: 2 sconces, damage 16, speed 600, radius 14, pierce -1, ttl 2.5, timer 1.8", async () => {
  await checkSconceRow(h, LEVEL);
});
