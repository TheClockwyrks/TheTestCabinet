// Wick — enemies/hp-scaling-kept-for-life: the health an enemy spawned with is
// the health it keeps, whatever the clock does afterward.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/enemies.md` ("Health scaling"): a common enemy "spawns with
//     `maxHp = hp * hpMul(time)` and `hp = maxHp`, and keeps that `maxHp` for
//     its life whatever the clock does afterward", with
//     `hpMul(time) = 1 + HP_SCALE_PER_MINUTE * floor(time / 60)`.
//   - `specs/enemies.md` ("The roster"): a moth's HP is `5`.
//   - `specs/instrumentation.md` (`setTick`): "Sets `tick` to `tick` ...
//     Nothing else changes ... every live entity stay[s] as [it] stand[s]".
//   - `specs/world.md` ("The plane"): "The run clock `time` is `tick / TICK_HZ`
//     seconds", so 120 ticks from tick 3540 carry the clock from time 59 to
//     time 61, across the minute boundary the multiplier steps on.
//
// WHAT IS READ. A moth spawned on the clock at time 59, where the multiplier is
// 1, reads `maxHp` 5; after 120 ticks carry the clock past time 60, where the
// multiplier a fresh spawn would take is 1.15, the same moth still reads `maxHp`
// 5 and `hp` 5. A build that recomputes an enemy's health from the clock reads
// 5.75 after the boundary and fails.
//
// WHY THE NIGHT IS POSED AS IT IS. One moth 150 units along +x and nothing else,
// every switch off: nothing spawns, nothing moves, no weapon fires, and no
// contact lands, so nothing but the rule under test can change the moth's health
// across the 120 ticks. The clock is posed to tick 3540 rather than run there, so
// the 120 ticks that follow are the whole of the run the moth lives through.
//
// TOLERANCE. `FIGURE_TOLERANCE` (1e-9) on each health reading, a stated figure
// read back, and on the clock the ticks reached.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan, assertWithin } from "../assert";
import { ENEMIES, FIGURE_TOLERANCE, TICK_HZ } from "../constants";
import {
  captureStill,
  createHarness,
  enemyById,
  isolate,
  present,
  spawnEnemyNear,
  type Harness,
} from "../harness";

/** The common this point reads: a moth, rank `common`, HP 5. */
const TYPE = "moth";

/** The clock the moth is spawned on: `floor(59 / 60)` is 0, so no scaling. */
const SPAWN_TIME = 59;

/** The minute boundary the multiplier steps on. */
const BOUNDARY_TIME = 60;

/** Ticks driven after the spawn: two seconds, across the boundary. */
const TICKS = 120;

/** Where the moth is posed, along +x of the lamplighter's center. */
const MOTH_DX = 150;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("keeps the moth's maxHp of 5 after the clock passes the minute", async () => {
  isolate(h);
  h.debug.setTick(SPAWN_TIME * TICK_HZ);
  const moth = spawnEnemyNear(h, TYPE, MOTH_DX, 0);
  const spawned = present(enemyById(h.snapshot(), moth), "the posed moth");
  assertWithin(
    spawned.maxHp,
    ENEMIES[TYPE].hp,
    FIGURE_TOLERANCE,
    "the moth's maxHp at spawn",
  );

  const after = await h.tick(TICKS);
  captureStill(h, "kept");

  assertGreaterThan(
    after.run.time,
    BOUNDARY_TIME,
    "the run clock after the ticks",
  );
  const now = present(enemyById(after, moth), "the moth after the minute");
  assertWithin(
    now.maxHp,
    ENEMIES[TYPE].hp,
    FIGURE_TOLERANCE,
    "the moth's maxHp after the clock passed the minute",
  );
  assertWithin(
    now.hp,
    ENEMIES[TYPE].hp,
    FIGURE_TOLERANCE,
    "the moth's hp after the clock passed the minute",
  );
});
