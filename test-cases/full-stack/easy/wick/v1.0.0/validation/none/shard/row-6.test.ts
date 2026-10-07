// Wick — shard/row-6: row 6 of `SHARD_LEVELS` is in force at level 6.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Shard"), row 6 of
// `SHARD_LEVELS`: damage `12`, cooldown `2.0`, speed `550`, radius
// `9`, duration `4.5`, amount `3`. "A shard is a circle of `radius`,
// fired from the player's center at `speed` toward the nearest enemy, or in
// the facing direction when no enemy exists ... Its pierce is
// `INFINITE_PIERCE` ... and it is removed after `duration` seconds", and
// "Amount `n` fires `n` shards on the same tick". ("Derived stats") the radius
// and the damage are the table value times `areaMul` and `damageMul`, both
// `1` with no passive held, and the speed, pierce, and duration the "table
// value, unchanged"; ("Cooldown timers") "After firing, the timer is set to
// the weapon's current cooldown", the table cooldown times a `cooldownMul` of
// `1`. So the firing tick creates 3 shards of radius `9`, damage `12`,
// speed `550`, pierce `-1`, and ttl `4.5`, and the timer reads `2.0` after
// it.
//
// THE POSE. An isolated night with nothing alive, Shard held at level 6 and
// fired through the shared `fireWeapon` (`shard/stage.ts`): every switch but
// `weaponFire` is held, so each shard stands at the center with the figures
// the firing gave it, flying along the facing direction and hitting nothing
// on its own tick.
//
// TOLERANCE. `FLOAT_TOL` on the radius, the damage, and the speed; `TIMER_TOL`
// on the ttl and the timer; the count and the pierce are exact.

import { afterEach, beforeEach, it } from "vitest";
import { createHarness, type Harness } from "../harness";
import { checkShardRow } from "./stage";

/** The level whose row is asserted. */
const LEVEL = 6;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("fires Shard at level 6 with row 6's figures: 3 shards, damage 12, speed 550, radius 9, pierce -1, ttl 4.5, timer 2.0", async () => {
  await checkShardRow(h, LEVEL);
});
