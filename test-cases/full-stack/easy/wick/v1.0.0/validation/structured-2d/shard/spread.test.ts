// shard/spread — the shards of one firing spread by SHARD_SPREAD about the
// direction of the nearest enemy.
//
// WHERE THE THRESHOLD COMES FROM. `specs/weapons.md` ("Shard"): "Amount `n`
// fires `n` shards on the same tick, shard `i` counted from `0` with its
// direction rotated by `(i − (n − 1) / 2) × SHARD_SPREAD` degrees, with
// `SHARD_SPREAD` (`15`)." Level 3's row gives amount 2, and with no Mirror
// held `amountBonus` is 0 (`specs/passives.md`), so `n` is 2 and the two
// directions are rotated `(0 − 0.5) × 15` = −7.5 and `(1 − 0.5) × 15` = +7.5
// degrees from the aim. "Derived stats" keeps the figure off every passive:
// "the spread angles ... are unchanged by any passive". Angles are "in
// degrees, with `0` along `+x` and positive angles turning toward `+y`" (The
// nearest enemy), which is what the offsets are measured under.
//
// WHAT THE OFFSETS ARE MEASURED FROM. The aim, "the unit vector from the
// player's center to the enemy's center", which with the one moth at
// `(300, 400)` from the lamplighter's center is `(0.6, 0.8)`: an angle of
// `atan2(0.8, 0.6)`. Each shard's own direction is the angle of the velocity
// the firing gave it, read after the firing tick, on which a new projectile is
// "first moving on the next tick" (`specs/world.md`, One tick, phase 6).
//
// WHAT IS COMPARED. The specification numbers the shards but fixes no order
// for the ids a tick hands out, so the two offsets are compared as a sorted
// pair against the sorted `[−7.5, +7.5]`: any build that aimed the two where
// the formula says passes, whichever it created first.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run with one moth, so the
// nearest enemy and therefore the aim is unambiguous, Shard at level 3 armed,
// `weaponFire` on and every other switch off, so no passive scales a figure
// and `effectMotion` being off leaves each velocity the fired one. That level
// 3 fires exactly two shards is `row-3`'s point; here the count is the
// precondition the offsets are read under.
//
// THE TOLERANCE. `ANGLE_EPS` on each offset, one rotation of an angle taken
// from a unit vector. Shards fired unspread are 7.5 degrees from where two of
// them belong, and a spread of the wrong step is off by degrees.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNear } from "../assert";
import { ANGLE_EPS, SHARD_LEVELS, SHARD_SPREAD } from "../constants";
import {
  angleOf,
  angularOffset,
  captureStill,
  createHarness,
  type Harness,
} from "../harness";
import { fireShard, TARGET_POST } from "./firing";

/** Level 3 of Shard: amount 2. */
const LEVEL = 3;
const ROW = SHARD_LEVELS[LEVEL - 1];

/** `(i − (n − 1) / 2) × SHARD_SPREAD` for `i` in `0 .. n − 1`, ascending. */
const OFFSETS: readonly number[] = Array.from(
  { length: ROW.amount },
  (_, i) => (i - (ROW.amount - 1) / 2) * SHARD_SPREAD,
);

/** The angle of the aim, which every offset is measured from. */
const BASE = angleOf(TARGET_POST.x, TARGET_POST.y);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("fires the two level-3 shards 7.5 degrees either side of the direction of the nearest enemy", async () => {
  if (ROW.amount !== 2) {
    throw new Error("the posed level must carry amount 2");
  }
  const firing = await fireShard(h, LEVEL, [TARGET_POST]);
  captureStill(h, "spread");

  assertEqual(
    firing.shards.length,
    ROW.amount,
    `the shards the firing tick created at level ${LEVEL} (specs/weapons.md, Shard)`,
  );

  // The offsets as a sorted pair, so the comparison holds whichever shard the
  // build fired first.
  const offsets = firing.shards
    .map((shard) => angularOffset(BASE, angleOf(shard.vx, shard.vy)))
    .sort((a, b) => a - b);
  for (let i = 0; i < offsets.length; i += 1) {
    assertNear(
      offsets[i],
      OFFSETS[i],
      ANGLE_EPS,
      `offset ${i} of the sorted shards, against (i − (n − 1) / 2) × SHARD_SPREAD (specs/weapons.md, Shard)`,
    );
  }
});
