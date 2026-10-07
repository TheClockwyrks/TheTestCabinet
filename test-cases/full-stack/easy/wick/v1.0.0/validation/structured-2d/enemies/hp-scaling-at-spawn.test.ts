// enemies/hp-scaling-at-spawn — a common's health is scaled by the minute of
// the run clock it spawns on.
//
// WHERE THE THRESHOLD COMES FROM. `specs/enemies.md` ("Health scaling"):
//
//   hpMul(time) = 1 + HP_SCALE_PER_MINUTE * floor(time / 60)
//
// "with `HP_SCALE_PER_MINUTE` (`0.15`) and `time` the run clock, in seconds, on
// the tick the enemy spawns. A common enemy spawns with `maxHp = hp *
// hpMul(time)` and `hp = maxHp`". A moth's table HP is `5` ("Common
// enemies"), so:
//   - at `LATE` (125 seconds), `floor(125 / 60)` is `2`, `hpMul` is
//     `1 + 0.15 × 2 = 1.3`, and the moth reads `maxHp` and `hp` `6.5`;
//   - at `EARLY` (59 seconds), `floor(59 / 60)` is `0`, `hpMul` is `1`, and it
//     reads `5`.
// The second reading is what makes the first a step rather than a slope: the
// multiplier changes on the minute, not with every second, so a build scaling
// by `time / 60` would read `6.475` at 59 seconds and fail.
//
// WHY THE WORLD IS POSED AS IT IS. An isolated run with every driver switch
// off, so no director spawn and no scripted event adds an enemy beside the one
// posed, and the clock is carried to each second with `setTick`, which "Sets
// `tick`" and leaves everything else standing, with "the health scaling of
// later spawns" following from it (`specs/instrumentation.md`). `spawnEnemy`
// then places the moth "through the real spawn path: its `maxHp` is scaled by
// the run clock exactly as a director spawn is", so what is read is the
// scaling the game applies to everything it spawns. The two moths are posed
// one after the other in the one run, the first cleared before the second, so
// the only thing that differs between the readings is the clock.
//
// THE TOLERANCE. `REAL_EPS`: each reading is one table value times one
// multiplier.

import { afterEach, beforeEach, it } from "vitest";
import { assertNear } from "../assert";
import { ENEMIES, hpMul, REAL_EPS, TICK_HZ } from "../constants";
import {
  captureStill,
  createHarness,
  isolate,
  placeEnemyNear,
  type Harness,
} from "../harness";
import { requireEnemy } from "./roster";

/** Where the moths stand: clear of the lamplighter, so nothing touches them. */
const POST = 300;

/** The run clock the scaled moth spawns on, in seconds: two minutes in. */
const LATE = 125;

/** The run clock the unscaled moth spawns on: one second short of the first. */
const EARLY = 59;

/** `5 × 1.3`, the health a moth spawned at 125 seconds carries. */
const SCALED = ENEMIES.moth.hp * hpMul(LATE);

/** `5 × 1`, the health a moth spawned at 59 seconds carries. */
const UNSCALED = ENEMIES.moth.hp * hpMul(EARLY);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("spawns a moth with 6.5 health at 125 seconds and with 5 at 59", async () => {
  isolate(h);

  h.debug.setTick(LATE * TICK_HZ);
  const scaled = placeEnemyNear(h, "moth", POST, 0);
  const late = requireEnemy(h.snapshot(), scaled);
  h.debug.clearEnemies();

  h.debug.setTick(EARLY * TICK_HZ);
  const unscaled = placeEnemyNear(h, "moth", POST, 0);
  const early = requireEnemy(h.snapshot(), unscaled);
  captureStill(h, "scaled");

  assertNear(
    late.maxHp,
    SCALED,
    REAL_EPS,
    "the maxHp of a moth spawned at a run clock of 125 seconds (specs/enemies.md, Health scaling)",
  );
  assertNear(
    late.hp,
    SCALED,
    REAL_EPS,
    "the hp of a moth spawned at a run clock of 125 seconds (specs/enemies.md, Health scaling)",
  );
  assertNear(
    early.maxHp,
    UNSCALED,
    REAL_EPS,
    "the maxHp of a moth spawned at a run clock of 59 seconds (specs/enemies.md, Health scaling)",
  );
  assertNear(
    early.hp,
    UNSCALED,
    REAL_EPS,
    "the hp of a moth spawned at a run clock of 59 seconds (specs/enemies.md, Health scaling)",
  );
});
