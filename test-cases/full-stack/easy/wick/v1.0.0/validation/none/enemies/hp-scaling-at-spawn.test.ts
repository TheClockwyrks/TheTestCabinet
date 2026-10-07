// Wick — enemies/hp-scaling-at-spawn: a common's health is scaled by the run
// clock on the tick it spawns.
//
// WHERE THE THRESHOLD COMES FROM. `specs/enemies.md` ("Health scaling"): "A
// common enemy's health grows with the night. The multiplier steps once a
// minute: `hpMul(time) = 1 + HP_SCALE_PER_MINUTE * floor(time / 60)`, with
// `HP_SCALE_PER_MINUTE` (`0.15`) and `time` the run clock, in seconds, on the
// tick the enemy spawns. A common enemy spawns with
// `maxHp = hp * hpMul(time)` and `hp = maxHp` ... `maxHp` is a real number." A
// moth's table `hp` is `5` ("Moth | `moth` | 5 | 100 | 5 | 10 | small |
// chase"). At `time` `125` the floor is `2`, so the multiplier is
// `1 + 0.15 x 2` = `1.3` and the health is `6.5`; at `time` `59` the floor is
// `0`, the multiplier is `1` and the health is the table's `5`. The pair is the
// point: a build that scaled by the wrong step reads a different `6.5`, and one
// that scaled continuously rather than "once a minute" reads `5.1475` at 59
// seconds.
//
// `specs/instrumentation.md` fixes what the clock pose does and does not do:
// `setTick` "Sets `tick` to `tick` ... Nothing else changes ... and everything
// derived from the clock, `time`, `spawnWindow`, the health scaling of later
// spawns ... follows from the next tick on", and `spawnEnemy` spawns "through
// the real spawn path: its `maxHp` is scaled by the run clock exactly as a
// director spawn is".
//
// THE POSE. An isolated night holding nothing but the lamplighter, every
// faculty held so no director spawn, no motion and no touch reads into it. The
// clock is posed to `125` seconds and a moth spawned 300 units along `+x`, then
// to `59` seconds and a second moth spawned 300 units along `-x`. Neither tick
// is run: both readings are of the spawn itself, which is where the rule
// applies.
//
// TOLERANCE. `FLOAT_TOL` on each health, a table figure times a multiplier the
// specification fixes exactly. The figures the check separates, `6.5` against
// `5`, are a unit and a half apart.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import { ENEMIES, FLOAT_TOL, TICK_HZ, hpMul } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  placeEnemy,
  type Harness,
} from "../harness";

/** The run clock the scaled moth spawns at, in seconds: two whole minutes in. */
const SCALED_TIME = 125;

/** The run clock the unscaled moth spawns at: a second short of the first step. */
const PLAIN_TIME = 59;

/** How far out each moth stands: clear of the lamplighter and of each other. */
const GAP = 300;

/** `5 x hpMul(125)` = `5 x 1.3` = `6.5`. */
const SCALED_HP = ENEMIES.moth.hp * hpMul(SCALED_TIME);

/** `5 x hpMul(59)` = `5 x 1` = `5`. */
const PLAIN_HP = ENEMIES.moth.hp * hpMul(PLAIN_TIME);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("spawns a moth at 6.5 health two minutes in and at 5 a second before the first step", async () => {
  await isolate(h);

  await h.debug.setTick(SCALED_TIME * TICK_HZ);
  const scaled = await placeEnemy(h, "moth", GAP, 0);

  await h.debug.setTick(PLAIN_TIME * TICK_HZ);
  const plain = await placeEnemy(h, "moth", -GAP, 0);
  await captureStill(h, "scaled");

  assertNear(
    scaled.maxHp,
    SCALED_HP,
    FLOAT_TOL,
    "the maxHp of a moth spawned at time 125",
  );
  assertNear(
    scaled.hp,
    SCALED_HP,
    FLOAT_TOL,
    "the hp of a moth spawned at time 125",
  );
  assertNear(
    plain.maxHp,
    PLAIN_HP,
    FLOAT_TOL,
    "the maxHp of a moth spawned at time 59",
  );
  assertNear(
    plain.hp,
    PLAIN_HP,
    FLOAT_TOL,
    "the hp of a moth spawned at time 59",
  );
});
