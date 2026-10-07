// Wick — shard/row-2: row 2 of `SHARD_LEVELS` is in force at level 2.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Shard"), row 2 of
// `SHARD_LEVELS`: damage `8`, cooldown `2.5`, speed `500`, radius
// `8`, duration `3.5`, amount `1`. "A shard is a circle of `radius`,
// fired from the player's center at `speed` toward the nearest enemy, or in
// the facing direction when no enemy exists ... Its pierce is
// `INFINITE_PIERCE` ... and it is removed after `duration` seconds", and
// "Amount `n` fires `n` shards on the same tick". ("Derived stats") the radius
// and the damage are the table value times `areaMul` and `damageMul`, both
// `1` with no passive held, and the speed, pierce, and duration the "table
// value, unchanged"; ("Cooldown timers") "After firing, the timer is set to
// the weapon's current cooldown", the table cooldown times a `cooldownMul` of
// `1`. So the firing tick creates 1 shard of radius `8`, damage `8`,
// speed `500`, pierce `-1`, and ttl `3.5`, and the timer reads `2.5` after
// it.
//
// THE POSE. An isolated night with nothing alive, Shard held at level 2 and
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
const LEVEL = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("fires Shard at level 2 with row 2's figures: 1 shard, damage 8, speed 500, radius 8, pierce -1, ttl 3.5, timer 2.5", async () => {
  await checkShardRow(h, LEVEL);
});
