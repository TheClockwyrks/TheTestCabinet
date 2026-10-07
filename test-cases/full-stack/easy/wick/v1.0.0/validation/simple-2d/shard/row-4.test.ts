// Wick — shard/row-4: row 4 of SHARD_LEVELS is in force at level 4.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/weapons.md` ("Shard"), the level table: row 4 is damage `10`,
//     cooldown `2.20`, speed `500`, radius `8`, duration `4.0`, amount `2`;
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
//     `ttl` down, so a new shard reads `4.0` after the firing tick.
//   - `specs/weapons.md` ("Cooldown timers"): "After firing, the timer is set
//     to the weapon's current cooldown", the table cooldown times
//     `cooldownMul` floored at `MIN_COOLDOWN`, so the timer reads `2.20` after
//     the firing tick. `specs/world.md` ("One tick"), phase 5: the timer
//     counts down and the due weapon fires within the same tick, so the
//     reading after that tick is the freshly set figure.
//
// WHAT IS READ. After the firing tick with one moth alive to aim at: the
// count of Shard projectiles, `2`, each carrying radius `8`, damage `10`, a
// velocity of length `500`, pierce `-1`, and `ttl` `4.0`; and Shard's timer,
// `2.20`. Every figure of the row is asserted, so a build whose table departs
// from the specification in any column at this level fails.
//
// WHY THE NIGHT IS POSED AS IT IS. One moth and Shard alone at level 4, every
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
const LEVEL = 4;

/** Row 4 of SHARD_LEVELS, as `constants.ts` restates it from the spec. */
const ROW = shardRow(LEVEL);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("fires 2 shards of row 4 at level 4 and sets the timer to 2.20", async () => {
  assertEqual(ROW.amount, 2, "the level-4 row's amount");
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
