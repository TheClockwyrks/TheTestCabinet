// controls/move-up — holding `ArrowUp` swims the forager up.
//
// specs/movement.md binds the `up` action to `ArrowUp` and `KeyW`, and has
// the four movement actions "read as held values, so the forager travels while
// one of them is held". `"playing"` is one of the screens that reads them. So:
// stand the forager still on a corridor that runs up, hold the key, and read
// what the game does — it travels, it faces up, and its y falls.
//
// `ArrowUp` is the FIRST of the two keys that row of the table gives the
// action. `KeyW` is controls/wasd-up's, and the two are separate points
// because a build that wired one and not the other must grade differently from
// one that wired neither.
//
// THE CORRIDOR IS POSED, NOT FOUND. Whether a tile has corridor on the side a
// given action pushes, and how much of it, is a property of the board a build
// invented: specs/maze.md fixes rules and never a layout, so on one board "hold
// up" has four tiles to cross and on another it has one and a wall.
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
// resolves each registered action, and an action is read only through a player
// controller in that controller's tick (specs/movement.md). Nothing here poses
// the forager once the run is laid out, so it stays under ordinary player control
// and answers the held action exactly as it does for a player.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import { ARROW_KEY, FORAGER_SPEED, TILE } from "../constants";
import { poseMoveKeyRun } from "../fixtures";
import {
  captureReplay,
  createHarness,
  startPlaying,
  TICK_HZ,
  type Harness,
} from "../harness";
import { requireSceneHeld, sceneGuard } from "../scene";

/** The first key specs/movement.md binds the `up` action to. */
const KEY = ARROW_KEY.up;

/**
 * How long the action is held before the reading, in ticks.
 *
 * A quarter of a second. At `FORAGER_SPEED` (`128` units a second,
 * specs/movement.md) that is one whole tile of travel, so the displacement the
 * check bounds sits far above any tolerance and the forager is still well inside
 * the run.
 */
const MEASURE_TICKS = TICK_HZ / 4;

/** Ticks at rest before the key goes down, so the clip opens on a still forager. */
const REST_TICKS = 24;

/** More held travel after the reading, so the clip shows a real swim. */
const TAIL_TICKS = TICK_HZ / 2;

/**
 * The least travel that reads as "it went that way", in logical units.
 *
 * Half a tile: unambiguous in both directions — far more than any sub-unit drift,
 * and comfortably under the `FORAGER_SPEED * MEASURE_TICKS / TICK_HZ` a
 * conforming build covers in the window. How FAST it travels is
 * maze-movement/constant-speed's point, not this one's.
 */
const MOVED = TILE / 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("ArrowUp swims the forager up", async () => {
  startPlaying(h);
  // A seven-tile corridor with the forager resting in the middle of it, facing
  // the rock across the corridor rather than along the run.
  const run = await poseMoveKeyRun(h, "up");
  assertEqual(
    h.snapshot().forager.dir,
    run.facing,
    "the forager rests facing the rock across the corridor",
  );
  // The forager is this check's SUBJECT, so it is expected to leave the tile it
  // was placed on. What the guard still watches is everything else: a life lost,
  // a screen change, a predator loose on the board.
  const watch = await sceneGuard(h, { foragerParked: false });

  const swim = await captureReplay(h, "move", async () => {
    await h.advance(REST_TICKS);
    const before = h.snapshot();
    h.hold(KEY);
    await h.advance(MEASURE_TICKS);
    const after = h.snapshot();
    // Held on past the reading purely so the recording shows the forager
    // traveling for a readable moment. The states above are already captured, so
    // nothing after this line can change the verdict.
    await h.advance(TAIL_TICKS);
    h.release(KEY);
    return { before, after };
  });

  requireSceneHeld(swim.after, watch);

  assertEqual(
    swim.after.forager.moving,
    true,
    "the forager travels while a movement action is held (specs/movement.md)",
  );
  assertEqual(
    swim.after.forager.dir,
    "up",
    "a forager at rest takes the desired direction when the tile that way is " +
      "open to it (specs/movement.md)",
  );
  assertGreaterThanOrEqual(
    swim.before.forager.y - swim.after.forager.y,
    MOVED,
    `logical units of upward travel in ${MEASURE_TICKS} ticks at ` +
      `FORAGER_SPEED (${FORAGER_SPEED})`,
  );
});
