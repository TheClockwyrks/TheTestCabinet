// instrumentation/advances-by-delta — a frame advances the game by the whole
// ticks its delta completes.
//
// specs/movement.md fixes the core this rests on: "The engine hands each frame a
// delta time and the simulation advances by the whole `TICK_DT` ticks that delta
// completes", and "The tick is the game's whole clock. Movement, cooldowns,
// timers and the creatures' decisions all advance inside it." So this hands the
// engine's own loop frames worth several ticks each and reads what the build did
// with them.
//
// WHY THIS POINT EXISTS. Every other check in this suite advances the simulation
// a frame at a time under a clock that hands each frame exactly one tick. That
// makes them all blind to this one claim: a build that ignores the delta it is
// handed — one that steps one tick per frame whatever the frame carried —
// answers every one-tick frame correctly and passes them, while a player whose
// display runs at sixty hertz sees a reef at half speed. This is the only point
// whose frames carry more than a tick.
//
// THE FRAMES ARE SCRIPTED, NOT WAITED FOR. `frame(ms)` hands the engine's loop a
// frame worth exactly `ms` of elapsed time, drawn and recorded like any other,
// so the same frames land on any host and the reading is the build's alone.
//
// WHAT IS WATCHED, AND WHY IT IS POSED THE WAY IT IS. `simTime` "is accumulated
// simulation time in seconds. Every tick adds its own length" (specs/state.md),
// so a frame worth `n` ticks raises it by exactly `n * TICK_DT`. The second
// witness is a released predator, as this point's own description states — and it
// is posed on a corridor with rock behind it so the reading cannot lie either way.
// A wanderer "picks at random among the open directions leading out of it" at
// each junction (specs/predators.md), so on a straight run with a dead end behind
// it there is exactly one direction it can take and its DISPLACEMENT is its
// travel. Left on a build's own maze it could round a corner and come back,
// covering two hundred units and reporting nearly none.
//
// THE FORAGER IS HELD ON A KEY THROUGHOUT, purely so the two stills are a picture
// a reviewer can read: it swims down its own corridor, revealing maze as it goes,
// so a build that honors the delta gives two visibly different frames and one
// that ignores it gives nearly the same frame twice. No assertion below reads the
// forager, so a build with a broken keyboard fails the `controls/move-*` points
// and is judged here on the clock alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import { ARROW_KEY, BRIGHT_HOLD, SIM_TIME_EPS, TICK_DT } from "../constants";
import { poseMaze, spawnPredator } from "../fixtures";
import {
  captureStill,
  createHarness,
  startPlaying,
  TICK_MS,
  type Harness,
} from "../harness";
import { requirePredatorMotion, requireSceneHeld, sceneGuard } from "../scene";

/**
 * The board: a hunter at a dead end, the forager well down the corridor from it,
 * and clear water ahead of each.
 *
 * `P` and `F` are sixteen tiles apart, which is far outside anything either can
 * sense (the Lanternjaw's reach is `320` units, ten tiles, at `G = 1`), and both
 * travel the same way, so the gap holds for the whole second and nothing here
 * ends in a catch.
 */
const BOARD = ["P" + ".".repeat(15) + "F" + ".".repeat(10)];

/** The key held for the camera. Nothing asserted below reads the forager. */
const KEY = ARROW_KEY.right;

/** Brightness posed for the picture alone, so the stills show lit corridor. */
const LIT = 1;

/**
 * One frame, run so the canvas holds a drawn picture before the first still.
 *
 * The stills are what the build drew, so something has to have drawn.
 */
const PAINT_FRAMES = 1;

/**
 * The ticks each scripted frame is worth.
 *
 * Twenty-four: a fifth of a second, which is what a frame carries on a display
 * that stalled for that long, and twenty-four times what any other check in this
 * suite hands a frame. A build stepping one tick per frame reports a
 * twenty-fourth of the figure below.
 */
const DELTA_TICKS = 24;

/** The elapsed time each scripted frame is handed, in milliseconds. */
const DELTA_MS = DELTA_TICKS * TICK_MS;

/**
 * Scripted frames handed over, one after another.
 *
 * Five of them cover one second of game time, which carries the slowest body
 * this board can hold two tiles: a disguised Lanternjaw travels at
 * `DRIFTER_SPEED` (`64`) and every other predator at more
 * (specs/predators/lanternjaw.md, specs/predators.md), so the second witness has
 * plainly moved.
 */
const DELTA_FRAMES = 5;

/** The seconds those frames are worth, exactly: every tick adds `TICK_DT`. */
const EXPECTED_SECONDS = DELTA_FRAMES * DELTA_TICKS * TICK_DT;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("advances by the whole ticks each frame's delta completes", async () => {
  startPlaying(h);
  const board = await poseMaze(h, BOARD);
  const den = board.mark("P");
  const start = board.mark("F");
  h.debug.setForagerTile(start.tx, start.ty);
  h.debug.setForagerDir("right");
  // `poseMaze` leaves the board empty, so one hunter is put back on it: this
  // point needs something that travels under its own power, and `addPredator`
  // adds one loose, patrolling and with its `released` flag `true` — the
  // "released predator" this point's description names.
  const subject = await spawnPredator(h, "lanternjaw", den, { dir: "right" });
  h.debug.setBrightness(LIT);
  h.debug.setBrightHold(BRIGHT_HOLD);
  const watch = await sceneGuard(h, { foragerParked: false });

  await h.advance(PAINT_FRAMES);
  const before = h.snapshot();
  captureStill(h, "before");

  assertEqual(
    before.screen,
    "playing",
    "the dive is live before the frames are handed over, so there is something " +
      "running to observe",
  );
  assertEqual(
    before.predators[subject]?.released,
    true,
    "the added hunter reports released, which is how this scenario knows it is " +
      "loose on the board rather than held in a den",
  );
  assertEqual(
    before.predators[subject]?.state,
    "wander",
    "the posed hunter is loose on the board rather than held in the den",
  );

  // The measurement. The key goes down for the camera, and each frame is handed
  // its delta; whatever happens is the build's own step on that delta.
  h.hold(KEY);
  for (let i = 0; i < DELTA_FRAMES; i += 1) await h.frame(DELTA_MS);
  h.release(KEY);
  const after = h.snapshot();
  captureStill(h, "after");

  requireSceneHeld(h.snapshot(), watch);

  assertLessThanOrEqual(
    Math.abs(after.simTime - before.simTime - EXPECTED_SECONDS),
    SIM_TIME_EPS,
    `how far simTime moved from the ${EXPECTED_SECONDS} s that ${DELTA_FRAMES} ` +
      `frames each handed ${DELTA_TICKS} ticks' worth of delta are worth`,
  );
  requirePredatorMotion(
    before,
    after,
    subject,
    "travel down a corridor with rock behind it over the second those frames " +
      "cover, which is what makes simTime a reading of the simulation rather " +
      "than of a counter",
  );
});
