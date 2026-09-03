// director/swarm-gnats-scaled — a swarm's gnats take the night's health
// scaling.
//
// WHERE THE THRESHOLD COMES FROM. specs/enemies.md ("Scripted events"): "Swarm
// gnats take health scaling like any common enemy". The scaling is ("Health
// scaling"): "`hpMul(time) = 1 + HP_SCALE_PER_MINUTE * floor(time / 60)`" with
// `HP_SCALE_PER_MINUTE` (`0.15`) and "`time` the run clock, in seconds, on the
// tick the enemy spawns. A common enemy spawns with `maxHp = hp * hpMul(time)`
// and `hp = maxHp`". The gnat's base is the roster's,
// "| Gnat | `gnat` | 2 | 160 | 3 | 8 | small | drift |". The 1:00 swarm fires
// on the tick the clock reads 60 seconds, so `floor(60 / 60)` is 1, the
// multiplier is `1.15`, and the figure is `2 × 1.15`, 2.3.
//
// WHY THIS IS ITS OWN POINT. The swarm's gnats arrive through the scripted
// event rather than through the window timer, and the gnat stands outside the
// spawn cap, so a build could reasonably have given the swarm a path of its own
// — and a path that skipped the scaling reads a flat 2 here. One minute in is
// also the earliest tick at which the multiplier is not `1`, so a build that
// never scales and a build that scales are separated by the smallest possible
// figure the specification offers.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated night with `events` alone, so
// the window timer's spawns cannot be read among the swarm's, and nothing has
// hit anything by the tick the health is read: `enemyContact` and `weaponFire`
// are off and no weapon is held, so `hp` is still what the spawn set.
//
// THE TOLERANCE. `FLOAT_TOL`, the `1e-9` a real number carried through one
// multiplication is allowed: `2 × 1.15` is not exact in binary, and a build
// that writes `2 * (1 + 0.15 * 1)` and one that writes `2 * 1.15` may differ in
// the last bit. The figure that separates a scaled gnat from an unscaled one is
// `0.3`, eight orders past it.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import { ENEMIES, FLOAT_TOL, hpMul } from "../constants";
import { captureStill, createHarness, type Harness } from "../harness";
import { poseSwarm, SWARM_SECONDS } from "./swarms";

/** `2 × hpMul(60)`: the gnat's base health at the multiplier of the first minute. */
const SCALED_HP = ENEMIES.gnat.hp * hpMul(SWARM_SECONDS);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("spawns the 1:00 swarm's gnats with maxHp 2.3", async () => {
  const swarm = await poseSwarm(h);
  await captureStill(h, "scaled");

  for (const gnat of swarm.gnats) {
    assertNear(
      gnat.maxHp,
      SCALED_HP,
      FLOAT_TOL,
      `gnat ${gnat.id}'s maxHp on the tick the swarm spawned`,
    );
    assertNear(
      gnat.hp,
      gnat.maxHp,
      FLOAT_TOL,
      `gnat ${gnat.id}'s hp against its maxHp`,
    );
  }
});
