// controls/move-right — ArrowRight swims the forager right.
//
// The corridor is POSED rather than found. Whether a tile of the maze a build
// invented has corridor on the side a given key pushes, and how much, is that
// build's own business (specs/maze.md fixes rules, never a layout), so a check
// that went hunting for one would measure the layout it landed in: on one board
// "press right" has four tiles to cross and on another one and a wall. Here every
// direction gets the same seven-tile run, stamped as the whole board through
// `setMaze` (specs/instrumentation.md), and the forager rests in the middle of it
// facing the ROCK ACROSS THE CORRIDOR — never along it, so the pose does not
// already answer the question, and the key is not a reversal, which
// specs/movement.md honors under a different rule.
//
// What is measured is what specs/movement.md states of a forager at rest: the
// `right` action sets the desired direction, and a forager at rest "takes the
// desired direction when the tile that way is open to it". So after a held key it
// is traveling, facing right, and further right than it started.
//
// The key is the FIRST of the `right` action's bindings (specs/movement.md's
// table). The second, KeyD, is `controls/wasd-right`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { poseMoveKeyRun } from "../fixtures";
import {
  captureReplay,
  createHarness,
  DIR_KEY,
  driveHeldKey,
  startPlaying,
  travelAlong,
  type Harness,
} from "../harness";
import { requireSceneHeld, sceneGuard } from "../scene";

/**
 * Frames the key is held before the verdict is read.
 *
 * At `FORAGER_SPEED` (128 units per second) 30 frames of the harness's 120 Hz
 * clock is a quarter of a second, which is one `TILE` of travel: enough that the
 * bound below is unambiguous, and short enough that the forager is still on the
 * posed run when it is read.
 */
const HOLD_TICKS = 30;

/**
 * Frames held after the reading, so a recorded clip shows the forager swimming
 * for a readable moment. They cannot reach an assertion: the states this check
 * reads were taken before them.
 */
const TAIL_TICKS = 90;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("ArrowRight swims the forager right", async () => {
  await startPlaying(h);
  const run = await poseMoveKeyRun(h, "right");
  // The forager is this check's SUBJECT, so it is expected to leave the tile it
  // was parked on. What the guard still watches is everything else: a life lost,
  // a screen change, a predator loose on the board.
  const watch = await sceneGuard(h, { foragerParked: false });

  const swum = await captureReplay(h, "move", () =>
    driveHeldKey(h, DIR_KEY.right, {
      holdTicks: HOLD_TICKS,
      tailTicks: TAIL_TICKS,
    }),
  );

  requireSceneHeld(swum.after, watch);

  // Half a tile: far more than any sub-unit drift, and comfortably under the
  // whole tile a conforming build covers in the window. How FAST it travels is
  // `maze-movement/constant-speed`'s verdict; this one asks only that the key
  // sent it that way.
  assertGreaterThan(
    travelAlong(swum.before, swum.after, "right"),
    swum.before.grid.tile / 2,
    `travel right over ${HOLD_TICKS} ticks from tile (${run.start.tx}, ${run.start.ty})`,
  );
  assertEqual(swum.after.forager.dir, "right", "the forager's facing");
  assertEqual(swum.after.forager.moving, true, "the forager is traveling");
});
