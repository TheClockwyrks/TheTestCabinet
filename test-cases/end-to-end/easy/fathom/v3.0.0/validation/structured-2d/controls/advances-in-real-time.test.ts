// controls/advances-in-real-time — the game runs itself on the wall clock.
//
// specs/movement.md fixes the core this rests on: "The engine hands each frame a
// delta time and the simulation advances by the whole `TICK_DT` ticks that delta
// completes", and "The tick is the game's whole clock. Movement, cooldowns,
// timers and the creatures' decisions all advance inside it." So this hands the
// game to the engine's own frame loop under a real clock and watches, with
// nothing stepping it from outside.
//
// WHY THIS POINT EXISTS. Every other check in this suite advances the simulation
// itself, a tick at a time under a `ConstantClock` that hands each frame exactly
// one tick. That makes them all blind to this one claim: a build that ignores the
// delta it is handed — one that steps a fixed amount per frame, or none at all —
// answers `advance` in a way those checks accept, while a player who opens it
// sees a reef that crawls or one that is frozen. This is the only point that runs
// the loop the way a player does.
//
// THE CLOCK IS THE POINT, SO THIS HARNESS BUILDS ITS OWN. `WallClock` is the
// clock a shipped game runs under: each frame's delta is the real time since the
// last one. Under it `advance(n)` no longer means `n` ticks, which is why nothing
// in the arrangement below advances anything — every line of it is a pose.
//
// WHAT IS WATCHED, AND WHY IT IS POSED THE WAY IT IS. `simTime` "is accumulated
// simulation time in seconds. Every tick adds its own length" (specs/state.md),
// so a running clock raises it and a stopped one does not. The second witness is
// a released predator, as this point's own description states — and it is posed on
// a corridor with rock behind it so the reading cannot lie either way. A wanderer
// "picks at random among the open directions leading out of it" at each junction
// (specs/predators.md), so on a straight run with a dead end behind it there is
// exactly one direction it can take and its DISPLACEMENT is its travel. Left on a
// build's own maze it could round a corner and come back, covering two hundred
// units and reporting nearly none.
//
// THE FORAGER IS HELD ON A KEY THROUGHOUT, purely so the two stills are a picture
// a reviewer can read: it swims down its own corridor, revealing maze as it goes,
// so a running build gives two visibly different frames and a frozen one gives
// the same frame twice. No assertion below reads the forager, so a build with a
// broken keyboard fails the `controls/move-*` points and is judged here on the
// clock alone.

import { WallClock } from "@test-cabinet/structured-2d";
import { afterEach, beforeEach } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { DRIFTER_SPEED } from "../../src/constants";
import { placeForager, poseMaze } from "../fixtures";
import {
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import {
  check,
  failPrecondition,
  requireSceneHeld,
  sceneGuard,
} from "../scene";

/**
 * The board: a hunter at a dead end, the forager well down the corridor from it,
 * and clear water ahead of each.
 *
 * `P` and `F` are sixteen tiles apart, which is far outside anything either can
 * sense (the Lanternjaw's reach is `320` units, ten tiles, at `G = 1`), and both
 * travel the same way, so the gap holds for the whole window and nothing here
 * ends in a catch.
 */
const BOARD = ["P" + ".".repeat(15) + "F" + ".".repeat(10)];

/** The predator the roster lists first, which specs/state.md fixes as index `0`. */
const SUBJECT = 0;

/** The key held for the camera. Nothing asserted below reads the forager. */
const KEY = "ArrowRight";

/** Brightness posed for the picture alone, so the stills show lit corridor. */
const LIT = 1;

/**
 * One frame, run so the canvas holds a drawn picture before the first still.
 *
 * The stills are what the build drew, so something has to have drawn. Under
 * `WallClock` this frame's delta is zero — the clock reports no elapsed time for
 * its first tick — so it renders and advances nothing.
 */
const PAINT_FRAMES = 1;

/**
 * The window, in real milliseconds, with nothing stepping the game.
 *
 * Two seconds: long enough that the two stills are plainly different frames and
 * that the floors below sit far above any noise, and short enough to spend in
 * every run.
 */
const WINDOW_MS = 2000;

/**
 * The least simulation time the window must have carried, in seconds.
 *
 * Half of it. Deliberately generous: the claim is that the game advances ITSELF,
 * not that it keeps perfect time, and a build that clamps its per-frame delta —
 * ordinary spiral-of-death protection — legally loses time to a stall. A running
 * build lands near `2.0`; a frozen one reports `0`.
 */
const ADVANCED_MIN = WINDOW_MS / 1000 / 2;

/**
 * The least ground the released predator must have covered, in logical units.
 *
 * Twenty: under a tile, and far under the `128` units even the slowest thing on
 * this board covers in the window — a disguised Lanternjaw travels at
 * `DRIFTER_SPEED` (`64`) and every other predator at more
 * (specs/predators/lanternjaw.md, specs/predators.md). The floor is low because
 * this is a second, independent witness that the SIMULATION ran rather than a
 * counter ticking, not a measurement of how fast anything travels. A frozen build
 * reports `0`.
 */
const TRAVELLED_MIN = 20;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ clock: new WallClock() });
});

afterEach(() => {
  h?.dispose();
});

check("advances itself in real time, with nothing stepping it", async () => {
  startPlaying(h);
  const board = await poseMaze(h, BOARD);
  const den = board.mark("P");
  const start = board.mark("F");
  await placeForager(h, start, "right");
  // `setMaze` returns every predator to the den and suspends the schedule
  // (specs/instrumentation.md), so one is posed back out: a denned hunter holds
  // still whether or not the clock is running, which would leave "nothing moved"
  // proving nothing. `"wander"` also makes its `released` flag `true`, which is
  // the "released predator" this point's description names.
  h.debug.setPredatorTile(SUBJECT, den.tx, den.ty);
  h.debug.setPredatorDir(SUBJECT, "right");
  h.debug.setPredatorState(SUBJECT, "wander");
  // The pellet under the forager, taken off rather than eaten, so nothing about
  // the opening frame is a score or a brightness event (specs/instrumentation.md
  // has removing one this way score nothing and clear no maze).
  h.debug.setPlankton(start.tx, start.ty, false);
  h.debug.setBrightness(LIT);
  const watch = await sceneGuard(h, null, { foragerParked: false });

  await h.advance(PAINT_FRAMES);
  const before = h.snapshot();
  captureStill(h, "before");

  assertEqual(
    before.screen,
    "playing",
    "the dive is live before the clock is handed back, so there is something " +
      "running to observe",
  );
  // Whether the snapshot carries `released` at all is
  // instrumentation/snapshot-shape's verdict, and whether a hunter's turn ever
  // comes is den/stagger's; this point only needs to know the hunter it is
  // watching is loose.
  const releasedFlag = before.predators[SUBJECT]?.released;
  if (typeof releasedFlag !== "boolean") {
    failPrecondition(
      "`released` reported as a boolean on the posed hunter, which is how this " +
        "scenario knows it is loose rather than held; specs/state.md requires " +
        "the field of every predator",
      "instrumentation/snapshot-shape",
      `released was ${JSON.stringify(releasedFlag)}`,
    );
  }
  if (!releasedFlag) {
    failPrecondition(
      'the posed hunter released, which `setPredatorState(index, "wander")` ' +
        "makes it (specs/instrumentation.md), so there is a hunter loose on " +
        "this board for a running clock to carry",
      "den/stagger",
      "released was false",
    );
  }
  assertEqual(
    before.predators[SUBJECT]?.state,
    "wander",
    "the posed hunter is loose on the board rather than held in the den",
  );

  // The measurement. Nothing here steps the game: the key goes down, the wall
  // clock runs, and whatever happens is the engine's loop driving the build.
  h.hold(KEY);
  await h.runFor(WINDOW_MS);
  const after = h.snapshot();
  h.release(KEY);
  captureStill(h, "after");

  requireSceneHeld(h.snapshot(), watch);

  assertGreaterThan(
    after.simTime - before.simTime,
    ADVANCED_MIN,
    `seconds of simulation the frame loop covered over ${WINDOW_MS} ms of real ` +
      `time, with nothing stepping it`,
  );
  const from = before.predators[SUBJECT];
  const to = after.predators[SUBJECT];
  assertGreaterThan(
    Math.hypot(to.x - from.x, to.y - from.y),
    TRAVELLED_MIN,
    `logical units the released ${from.kind} covered over the same window, ` +
      `down a corridor with rock behind it (the slowest thing on this board ` +
      `travels at DRIFTER_SPEED, ${DRIFTER_SPEED})`,
  );
});
