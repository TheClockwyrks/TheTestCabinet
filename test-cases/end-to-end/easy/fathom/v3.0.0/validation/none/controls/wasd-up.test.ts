// controls/wasd-up — holding `KeyW` swims the forager up.
//
// specs/movement.md binds the `up` action to `ArrowUp` and `KeyW`, and has
// the four movement actions "read as held values, so the forager travels while
// one of them is held". `"playing"` is one of the screens that reads them. So:
// stand the forager still on a corridor that runs up, hold the key, and read
// what the game does — it travels, it faces up, and its y falls.
//
// `KeyW` is the SECOND of the two keys that row of the table gives the
// action. `ArrowUp` is controls/move-up's, and the two are separate points
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
// THE KEY IS REAL IN THE STRONGEST SENSE. `hold` and `release` press it through
// Chromium's own input pipeline, so what reaches the build is a browser-trusted
// DOM key event on the real page. specs/instrumentation.md puts the keyboard in
// the runtime beneath the game and gives the surface no keyboard operation at
// all, so the whole path from a physical key to a moving forager is the build's
// own and every step of it is exercised here.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import { TICK_HZ, TILE } from "../constants";
import { poseMoveKeyRun } from "../fixtures";
import { captureReplay, createHarness, type Harness } from "../harness";
import { requireSceneHeld, sceneGuard, startPlaying } from "../scene";

/** The second key specs/movement.md binds the `up` action to. */
const KEY = "KeyW";

/**
 * The held window the verdict is read at the end of, in ticks.
 *
 * A quarter of a second. At `FORAGER_SPEED` (`128`) that is exactly one `TILE`
 * (`32`) of travel on a conforming build, which is comfortably more than the
 * threshold below and comfortably less than the corridor the fixture lays out.
 */
const HOLD_TICKS = TICK_HZ / 4;

/** Ticks at rest before the key goes down, so the clip opens on a still forager. */
const REST_TICKS = 24;

/** Ticks the key stays down past the reading, purely so the clip reads as travel. */
const TAIL_TICKS = 60;

/**
 * How far the forager must have travelled along the key's axis, in logical units.
 *
 * HALF A TILE, AND POSITION RATHER THAN THE TILE INDEX. Builds legitimately differ
 * on WHEN `tx`/`ty` flips — on crossing the boundary geometrically, or on arriving
 * at the next center — and specs/state.md pins neither ("the tile whose bounds
 * contain its center"), so a tile-index comparison over a window that covers
 * exactly one tile is a coin flip decided by floating-point accumulation. Position
 * is exact and convention-free. Half a tile is unambiguous in both directions:
 * far more than any sub-unit drift, and comfortably under the `TILE` a conforming
 * build covers in the window.
 */
const MOVED_MIN = TILE / 2;

let h: Harness;

beforeEach(async (ctx) => {
  h = await createHarness(ctx);
});

afterEach(async () => {
  await h.dispose();
});

it("swims the forager up while KeyW is held", async () => {
  await startPlaying(h);
  const run = await poseMoveKeyRun(h, "up");
  // The forager is the SUBJECT here, so it is not held to staying put; what the
  // guard still catches is a life lost or the dive leaving live play under the
  // measurement, either of which would make this a reading of some other
  // situation.
  const guard = await sceneGuard(h, null, { foragerParked: false });

  const moved = await captureReplay(h, "move", async () => {
    await h.advance(REST_TICKS);
    const before = (await h.snapshot()).forager;
    await h.hold(KEY);
    await h.advance(HOLD_TICKS);
    const after = (await h.snapshot()).forager;
    // Held on past the reading: the clip shows a forager swimming for a readable
    // moment rather than a single step, and nothing measured moves, because both
    // readings are already taken.
    await h.advance(TAIL_TICKS);
    await h.release(KEY);
    return { before, after };
  });

  requireSceneHeld(h, await h.snapshot(), guard);

  assertEqual(moved.after.moving, true, "the forager reads as traveling");
  assertEqual(moved.after.dir, "up", "its heading");
  assertGreaterThanOrEqual(
    moved.before.y - moved.after.y,
    MOVED_MIN,
    `units travelled up over ${HOLD_TICKS} ticks from tile ` +
      `(${run.tile.tx}, ${run.tile.ty}), where the forager rested facing ` +
      `${run.facing} into rock`,
  );
});
