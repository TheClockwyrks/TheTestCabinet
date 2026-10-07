// Wick — shard/row-7: row 7 of SHARD_LEVELS is in force at level 7.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Shard"), the level table: row 7 is damage `15`,
//     cooldown `2.00`, speed `550`, radius `9`, duration `4.5`, amount `3`;
//     "Every level table has `MAX_WEAPON_LEVEL` (`8`) rows; row `i` is level
//     `i + 1`".
//   - `specs/weapons.md` ("Shard"): "A shard is a circle of `radius`, fired
//     from the player's center at `speed` toward the nearest enemy ... Its
//     pierce is `INFINITE_PIERCE` ... and it is removed after `duration`
//     seconds", and "Amount `n` fires `n` shards on the same tick".
//   - `specs/weapons.md` ("Derived stats"): damage is "table value ×
//     `damageMul`", radius "table value × `areaMul`", amount "table value +
//     `amountBonus`", and speed and duration "table value, unchanged"; with no
//     passive held every multiplier is `1` and the bonus `0`
//     (`specs/passives.md`).
//   - `specs/weapons.md` ("Projectiles and pierce"): "A projectile's `ttl` is
//     set to its `duration` when it is fired"; `specs/world.md` ("One tick"),
//     phase 6: only a projectile "that existed before this tick" counts its
//     `ttl` down, so a new shard reads `4.5` after the firing tick.
//   - `specs/weapons.md` ("Cooldown timers"): "After firing, the timer is set
//     to the weapon's current cooldown", the table cooldown times
//     `cooldownMul` floored at `MIN_COOLDOWN`, so the timer reads `2.00` after
//     the firing tick. `specs/world.md` ("One tick"), phase 5: the timer
//     counts down and the due weapon fires within the same tick, so the
//     reading after that tick is the freshly set figure.
//
// WHAT IS READ. After the firing tick with one moth alive to aim at: the
// count of Shard projectiles, `3`, each carrying radius `9`, damage `15`, a
// velocity of length `550`, pierce `-1`, and `ttl` `4.5`; and Shard's timer,
// `2.00`. Every figure of the row is asserted, so a build whose table departs
// from the specification in any column at this level fails.
//
// WHY THE NIGHT IS POSED AS IT IS. One moth and Shard alone at level 7, every
// switch off but `weaponFire`. Shard fires with or without an enemy, and the
// moth is there so the firing read is the ordinary one, aimed at an enemy.
// `enemyMotion` off holds it `150` units out, so no shard created at the
// center overlaps it on the firing tick and every shard is still in
// `projectiles` to read; `effectMotion` off holds each shard at its launch
// velocity.
//
// TOLERANCE. `FIGURE_TOLERANCE` on radius, damage, speed, `ttl`, and the
// timer, each a stated figure or a product of stated figures read back as a
// double. None on pierce or the count, whole numbers the specification states.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  projectilesOf,
  type Harness,
} from "../harness";
import {
  ROW_TARGET,
  armShard,
  assertShardOfRow,
  assertTimerOfRow,
  shardRow,
} from "./volley";

/** The level this point holds Shard at. */
const LEVEL = 7;

/** Row 7 of SHARD_LEVELS, as `constants.ts` restates it from the spec. */
const ROW = shardRow(LEVEL);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("fires 3 shards of row 7 at level 7 and sets the timer to 2.00", async () => {
  assertEqual(ROW.amount, 3, "the level-7 row's amount");
  const volley = armShard(h, LEVEL, [ROW_TARGET]);

  const after = await h.tick(1);
  captureStill(h, "row");

  const shards = projectilesOf(after, "shard");
  assertEqual(
    shards.length,
    ROW.amount,
    "Shard projectiles after the firing tick",
  );
  for (const shard of shards) assertShardOfRow(shard, ROW, `shard ${shard.id}`);
  assertTimerOfRow(after, volley.slot, ROW);
});
