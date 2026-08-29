// controls/wasd-left — holding `KeyA` swims the forager left.
//
// specs/movement.md binds the `left` action to `ArrowLeft` and `KeyA`, and has
// the four movement actions "read as held values, so the forager travels while
// one of them is held". `"playing"` is one of the screens that reads them. So:
// stand the forager still on a corridor that runs left, hold the key, and read
// what the game does — it travels, it faces left, and its x falls.
//
// `KeyA` is the SECOND of the two keys that row of the table gives the
// action. `ArrowLeft` is controls/move-left's, and the two are separate points
// because a build that wired one and not the other must grade differently from
// one that wired neither.
//
// THE CORRIDOR IS POSED, NOT FOUND. Whether a tile has corridor on the side a
// given action pushes, and how much of it, is a property of the board a build
// invented: specs/maze.md fixes rules and never a layout, so on one board "hold
// left" has four tiles to cross and on another it has one and a wall.
// `poseMoveKeyRun` stamps the same run under every build through `setMaze`,
// which specs/instrumentation.md exempts from those rules, so what is measured is
// the action rather than the layout it landed in.
//
// AND THE FORAGER RESTS FACING THE ROCK ACROSS THE CORRIDOR, never along the run.
// Faced along it, a build that never read a key and simply swam the way it was
// pointing would pass both readings below. Facing rock it cannot leave its tile
// until the action is read and honored — specs/movement.md: "A forager at rest
// takes the desired direction when the tile that way is open to it, and stays at
// rest otherwise" — so the heading and the travel are the action's doing and
// nothing else's.
//
// WHAT THIS DOES NOT DECIDE. How FAST the forager travels, which is
// maze-movement/constant-speed's, and WHERE a turn is taken, which is
// maze-movement/turn-at-center's. Asserting either here would cost one build two
// points for one fault, so the displacement bound below is deliberately loose:
// half a tile the right way says "it went that way" and nothing more.
//
// The action reaches the game through the engine, which owns the keyboard and
// resolves each action the game registered (specs/movement.md), so the key
// dispatched here is the one a player presses.

import { afterEach, beforeEach } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { poseMoveKeyRun } from "../fixtures";
import {
  captureReplay,
  createHarness,
  driveHeldKey,
  startPlaying,
  travelAlong,
  type Harness,
} from "../harness";
import { check, denAll, requireSceneHeld, sceneGuard } from "../scene";

/** The second key specs/movement.md binds the `left` action to. */
const KEY = "KeyA";

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

check("KeyA swims the forager left", async () => {
  await startPlaying(h);
  const run = await poseMoveKeyRun(h, "left");
  const quiet = await denAll(h);
  // The forager is this check's SUBJECT, so it is expected to leave the tile it
  // was parked on. What the guard still watches is everything else: a life lost,
  // a screen change, a predator loose on the board.
  const watch = await sceneGuard(h, quiet, { foragerParked: false });

  const swum = await captureReplay(h, "move", () =>
    driveHeldKey(h, KEY, {
      holdTicks: HOLD_TICKS,
      tailTicks: TAIL_TICKS,
    }),
  );

  requireSceneHeld(swum.after, watch);

  // Half a tile: far more than any sub-unit drift, and comfortably under the
  // whole tile a conforming build covers in the window. How FAST it travels is
  // maze-movement/constant-speed's verdict; this one asks only that the key
  // sent it that way.
  assertGreaterThan(
    travelAlong(swum.before, swum.after, "left"),
    swum.before.grid.tile / 2,
    `travel left over ${HOLD_TICKS} ticks from tile (${run.start.tx}, ${run.start.ty})`,
  );
  assertEqual(swum.after.forager.dir, "left", "the forager's facing");
  assertEqual(swum.after.forager.moving, true, "the forager is traveling");
});
