// Wick — enemies/age-counts-per-tick: an enemy's age is the seconds since it
// spawned, one `TICK_DT` added on every tick.
//
// WHAT THE SPECIFICATION FIXES, AND WHERE.
//   - `specs/enemies.md` ("The life of an enemy"): an enemy "spawns at full
//     health, with `age` `0`", and "`age` is the seconds since it spawned:
//     every tick adds `TICK_DT` (`1 / 60`) to it".
//   - `specs/world.md` ("One tick"), phase 4: "Every enemy ages by `TICK_DT`,
//     and, while `enemyMotion` is on, moves", so the ageing is not the motion's
//     and runs with the switch off.
//   - `specs/instrumentation.md` (`setEnemyMotion`): while the switch is off
//     "Every enemy holds its position and heading. `age` and `contactCooldown`
//     still count".
//
// WHAT IS READ. A moth's `age` at the pose, which is `0`, and its `age` after
// thirty ticks, which is `30 × TICK_DT` = 0.5 seconds. A build that ages in
// frames rather than ticks, that ages only while an enemy moves, or that leaves
// `age` at `0` answers differently.
//
// WHY THE NIGHT IS POSED AS IT IS. One moth 150 units along +x and nothing else,
// every switch off: the moth cannot move, cannot be hit, and cannot be removed,
// so the thirty ticks change nothing about it but the figure under test.
//
// TOLERANCE. `FIGURE_TOLERANCE` (1e-9) on the age at the pose, an exact zero,
// and `MOTION_TOLERANCE` (1e-6) after the ticks, since a build accumulates
// thirty additions of a value that is not exact in binary.

import { afterEach, beforeEach, it } from "vitest";
import { assertWithin } from "../assert";
import { FIGURE_TOLERANCE, MOTION_TOLERANCE, TICK_DT } from "../constants";
import {
  captureStill,
  createHarness,
  enemyById,
  isolate,
  present,
  spawnEnemyNear,
  type Harness,
} from "../harness";

/** The enemy this point reads; every type ages the same way. */
const TYPE = "moth";

/** Where the moth stands, along +x of the lamplighter's center. */
const MOTH_DX = 150;

/** How many ticks the age is read across. */
const TICKS = 30;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h.dispose();
});

it("reads the moth's age as 0 at its spawn and 30 × TICK_DT after 30 ticks", async () => {
  isolate(h);
  const moth = spawnEnemyNear(h, TYPE, MOTH_DX, 0);
  const spawned = present(enemyById(h.snapshot(), moth), "the posed moth");
  assertWithin(spawned.age, 0, FIGURE_TOLERANCE, "the moth's age at its spawn");

  const after = await h.tick(TICKS);
  captureStill(h, "age");

  const now = present(enemyById(after, moth), "the moth after the ticks");
  assertWithin(
    now.age,
    TICKS * TICK_DT,
    MOTION_TOLERANCE,
    `the moth's age after ${TICKS} ticks`,
  );
});
