// Wick — enemies/hp-scaling-at-spawn: a common enemy's health at spawn is its
// row's HP times the multiplier the run clock gives that minute.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/enemies.md` ("Health scaling"):
//     `hpMul(time) = 1 + HP_SCALE_PER_MINUTE * floor(time / 60)` with
//     `HP_SCALE_PER_MINUTE` (`0.15`) and "`time` the run clock, in seconds, on
//     the tick the enemy spawns. A common enemy spawns with
//     `maxHp = hp * hpMul(time)` and `hp = maxHp`".
//   - `specs/enemies.md` ("The roster"): a moth's HP is `5`, "the base the
//     scaling below multiplies at spawn", and its rank is `common`.
//   - `specs/instrumentation.md` (`setTick`): "Sets `tick` to `tick` ... and
//     everything derived from the clock, `time`, `spawnWindow`, the health
//     scaling of later spawns ... follows from the next tick on";
//     (`spawnEnemy`): "its `maxHp` is scaled by the run clock exactly as a
//     director spawn is".
//
// WHAT IS READ. Two spawns on two clocks. At time 125 the multiplier is
// `1 + 0.15 × floor(125 / 60)` = 1.3, so the moth reads `maxHp` 6.5 and `hp`
// 6.5. At time 59 the multiplier is `1 + 0.15 × floor(59 / 60)` = 1, so the moth
// reads 5. The second reading is what makes the first one about the FLOOR rather
// than about any growth at all: a build scaling continuously with the clock
// reads about 5.7 at time 59 and fails, and one that never scales reads 5 at
// time 125 and fails.
//
// WHY THE NIGHT IS POSED AS IT IS. Two isolated nights, each holding one moth
// and nothing else with every switch off: nothing spawns, nothing moves, nothing
// hits, and the only thing that decided the moth's health is the clock the pose
// set. Each moth is posed 150 units along +x, clear of the lamplighter.
//
// TOLERANCE. `FIGURE_TOLERANCE` (1e-9) on each health reading, the product of
// two stated figures a build may form in either order.

import { afterEach, beforeEach, it } from "vitest";
import { assertWithin } from "../assert";
import {
  ENEMIES,
  FIGURE_TOLERANCE,
  TICK_HZ,
  hpMul,
  type EnemyId,
} from "../constants";
import {
  captureStill,
  createHarness,
  enemyById,
  isolate,
  present,
  spawnEnemyNear,
  type EnemySnapshot,
  type Harness,
} from "../harness";

/** The common this point reads: a moth, rank `common`, HP 5. */
const TYPE: EnemyId = "moth";

/** The clock the scaled spawn is made on: `floor(125 / 60)` is 2. */
const SCALED_TIME = 125;

/** The clock the unscaled spawn is made on: `floor(59 / 60)` is 0. */
const PLAIN_TIME = 59;

/** Where each moth is posed, along +x of the lamplighter's center. */
const MOTH_DX = 150;

/** Spawn one moth on the clock `time` in a night of its own. */
function spawnAt(h: Harness, time: number): EnemySnapshot {
  isolate(h);
  h.debug.setTick(time * TICK_HZ);
  const id = spawnEnemyNear(h, TYPE, MOTH_DX, 0);
  return present(enemyById(h.snapshot(), id), `the moth spawned at ${time}`);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("spawns the moth with 6.5 health at time 125 and 5 at time 59", async () => {
  const scaled = spawnAt(h, SCALED_TIME);
  // One inert tick, so the frame kept as evidence holds the scaled moth; every
  // switch is off, and nothing in the night moves or changes its health.
  await h.tick(1);
  captureStill(h, "scaled");
  const plain = spawnAt(h, PLAIN_TIME);

  const expected = ENEMIES[TYPE].hp * hpMul(SCALED_TIME);
  assertWithin(
    scaled.maxHp,
    expected,
    FIGURE_TOLERANCE,
    `the maxHp of a moth spawned at time ${SCALED_TIME}`,
  );
  assertWithin(
    scaled.hp,
    expected,
    FIGURE_TOLERANCE,
    `the hp of a moth spawned at time ${SCALED_TIME}`,
  );
  assertWithin(
    plain.maxHp,
    ENEMIES[TYPE].hp,
    FIGURE_TOLERANCE,
    `the maxHp of a moth spawned at time ${PLAIN_TIME}`,
  );
  assertWithin(
    plain.hp,
    ENEMIES[TYPE].hp,
    FIGURE_TOLERANCE,
    `the hp of a moth spawned at time ${PLAIN_TIME}`,
  );
});
