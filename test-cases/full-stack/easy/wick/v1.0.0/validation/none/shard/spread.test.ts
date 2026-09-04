// Wick — shard/spread: shards spread by `SHARD_SPREAD`.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Shard"): "Amount `n`
// fires `n` shards on the same tick, shard `i` counted from `0` with its
// direction rotated by `(i − (n − 1) / 2) × SHARD_SPREAD` degrees, with
// `SHARD_SPREAD` (`15`)", the direction being "toward the nearest enemy";
// ("The nearest enemy"): "Angles are in degrees, with `0` along `+x` and
// positive angles turning toward `+y`". Row 3 of `SHARD_LEVELS` has amount
// `2`, so the two shards leave at the direction toward the nearest enemy
// rotated by `-7.5` and `+7.5` degrees.
//
// WHAT IS READ. The angle of each shard's velocity, against the angle from
// the lamplighter's center to the moth's center read off the state the tick
// fired from, `±7.5`: the specification counts the shards by `i` without
// fixing which id each takes, so the two angles are sorted and compared as a
// pair rather than by id.
//
// THE POSE. An isolated night with one moth at `(300, 400)`, `500` units out
// along `53.13` degrees, so neither rotated direction crosses the `0/360`
// seam and the two angles sort cleanly; then Shard held at level 3 and fired
// through the shared `fireWeapon`. `enemyMotion` is held so the moth stands
// where it was posed, and `effectMotion` so each shard stands at the center
// with the velocity the firing gave it; the shards are created `500` from the
// moth, so neither hits on its own tick.
//
// TOLERANCE. `ANGLE_TOL` on each angle, recovered from a velocity through
// `atan2`; the two directions are `15` degrees apart and an unrotated shard
// `7.5` from either.

import { afterEach, beforeEach, it } from "vitest";
import { assertAngleNear, assertEqual } from "../assert";
import { ANGLE_TOL, SHARD_SPREAD, weaponRow } from "../constants";
import {
  angleFrom,
  captureStill,
  createHarness,
  fireWeapon,
  isolate,
  placeEnemy,
  type Harness,
} from "../harness";
import { SHARD, shardsOf } from "./stage";

/** The row of two shards: `SHARD_LEVELS` row 3. */
const LEVEL = 3;

/** The row's amount, `2`. */
const AMOUNT = weaponRow(SHARD, LEVEL).amount!;

/** The one moth: `500` from the origin along `53.13` degrees. */
const MOTH = { x: 300, y: 400 };

/** The rotations the formula gives shard `i`: `(i − (n − 1) / 2) × SHARD_SPREAD`. */
const ROTATIONS = Array.from(
  { length: AMOUNT },
  (_, i) => (i - (AMOUNT - 1) / 2) * SHARD_SPREAD,
);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("fires two level-3 shards at the direction toward the moth rotated by -7.5 and +7.5 degrees", async () => {
  await isolate(h);
  await placeEnemy(h, "moth", MOTH.x, MOTH.y);

  const firing = await fireWeapon(h, SHARD, LEVEL);
  await captureStill(h, "spread");

  const shards = shardsOf(firing);
  assertEqual(
    shards.length,
    AMOUNT,
    `Shard projectiles the level-${LEVEL} firing tick created`,
  );
  const toward = angleFrom(firing.before.run.player, MOTH);
  const angles = shards
    .map((shard) => angleFrom({ x: 0, y: 0 }, { x: shard.vx, y: shard.vy }))
    .sort((a, b) => a - b);
  for (const [index, rotation] of ROTATIONS.entries()) {
    assertAngleNear(
      angles[index]!,
      toward + rotation,
      ANGLE_TOL,
      `the ${index}th smallest shard angle, the direction toward the moth rotated by ${rotation} degrees`,
    );
  }
});
