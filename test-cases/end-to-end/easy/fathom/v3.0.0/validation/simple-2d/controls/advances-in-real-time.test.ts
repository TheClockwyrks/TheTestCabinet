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
// itself, a frame at a time under a `ConstantClock` that hands each frame exactly
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

import { WallClock } from "@test-cabinet/simple-2d";
import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThan } from "../assert";
import { ARROW_KEY, BRIGHT_HOLD, DRIFTER_SPEED } from "../constants";
import { poseMaze, spawnPredator } from "../fixtures";
import {
  captureStill,
  createHarness,
  poseBrightness,
  startPlaying,
  type Harness,
} from "../harness";
import { requireSceneHeld, sceneGuard } from "../scene";

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

/** The key held for the camera. Nothing asserted below reads the forager. */
const KEY = ARROW_KEY.right;

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
 * One window of real time handed back to the build, in milliseconds.
 *
 * Two seconds: long enough that the two stills are plainly different frames, and
 * short enough to spend in every run. On any host that is not starved this is the
 * whole measurement — the floor below is met inside the first one and the watch
 * ends there.
 */
const WINDOW_MS = 2000;

/**
 * The most real time the build is given to reach that floor, in milliseconds.
 *
 * WHY THERE IS A DEADLINE AND NOT A FIXED WINDOW. This is the one point in the
 * suite whose REQUIREMENT is real time: the game has to move with nothing driving
 * it, so real time has to pass and the reading has to be taken from outside. What
 * must NOT be read from outside is how MUCH the game moved per second of wall
 * clock — a host running other work hands a page a fraction of the animation
 * frames it would otherwise get, and a build that is running perfectly then covers
 * a fraction of the simulation in the same two seconds. Grading that ratio grades
 * the machine.
 *
 * So the window is a floor on the BUILD'S OWN clock rather than a budget on the
 * host's: the game is handed back {@link WINDOW_MS} at a time until its own
 * `simTime` has gained {@link ADVANCED_MIN}, and only a build whose loop never
 * steps the simulation runs out of this. Half a minute is dozens of windows —
 * far past any stall a scheduler can impose on a page that is genuinely running —
 * and a healthy build never sees the second one.
 */
const DEADLINE_MS = 30_000;

/**
 * The least simulation time the build's own loop must have covered, in seconds.
 *
 * Half a second, which is an absolute floor rather than a share of the window,
 * and deliberately far below what the window carries on a quiet host — a running
 * build covers about `2.0` inside the first window alone. The claim is that the
 * game advances ITSELF, not that it keeps pace with a wall clock: a build that
 * clamps its per-frame delta, which is ordinary spiral-of-death protection, loses
 * time to a stall perfectly legally, and a page the host has starved of animation
 * frames loses more. A frozen build reports `0` and gains nothing however long it
 * is given, which is the whole difference this point decides.
 *
 * It is also what makes {@link TRAVELLED_MIN} reachable: half a second carries the
 * slowest body this board can hold `32` units, which is over that floor.
 */
const ADVANCED_MIN = 0.5;

/**
 * The least ground the released predator must have covered, in logical units.
 *
 * Twenty: under a tile, and under the `32` units the slowest thing on this board
 * covers in the {@link ADVANCED_MIN} of simulation the watch waits for — a
 * disguised Lanternjaw travels at `DRIFTER_SPEED` (`64`) and every other predator
 * at more (specs/predators/lanternjaw.md, specs/predators.md). Stated against
 * that floor rather than against the window, because the window is what a loaded
 * host shortens and the floor is not. This is a second, independent witness that
 * the SIMULATION ran rather than a counter ticking, so it is deliberately low; a
 * frozen build reports `0`.
 */
const TRAVELLED_MIN = 20;

let h: Harness;

beforeEach(async () => {
  h = await createHarness({ clock: new WallClock() });
});

afterEach(() => {
  h?.dispose();
});

it("advances itself in real time, with nothing stepping it", async () => {
  await startPlaying(h);
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
  await poseBrightness(h, LIT, BRIGHT_HOLD);
  const watch = await sceneGuard(h, { foragerParked: false });

  await h.advance(PAINT_FRAMES);
  const before = h.snapshot();
  captureStill(h, "before");

  assertEqual(
    before.screen,
    "playing",
    "the dive is live before the clock is handed back, so there is something " +
      "running to observe",
  );
  // The hunter this point watches is loose, which is what makes "it travelled"
  // a reading of a running clock rather than of a body that was never going to
  // move: `addPredator` arrives "loose and patrolling ... its `released` flag is
  // `true`" (specs/instrumentation.md).
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

  // The measurement. Nothing here steps the game: the key goes down, the wall
  // clock runs, and whatever happens is the engine's loop driving the build.
  h.hold(KEY);
  // Windows of real time, handed back until the BUILD'S OWN clock has gained the
  // floor or the deadline has gone by. On a quiet host the first one carries all
  // of it and this is a single `runFor`; on a loaded one the game simply gets more
  // real time, which is what keeps the reading a property of the build.
  const deadline = Date.now() + DEADLINE_MS;
  let after = before;
  do {
    await h.runFor(WINDOW_MS);
    after = h.snapshot();
  } while (
    after.simTime - before.simTime <= ADVANCED_MIN &&
    Date.now() < deadline
  );
  h.release(KEY);
  captureStill(h, "after");

  requireSceneHeld(h.snapshot(), watch);

  assertGreaterThan(
    after.simTime - before.simTime,
    ADVANCED_MIN,
    `seconds of simulation the frame loop covered with nothing stepping it, ` +
      `over real time handed back ${WINDOW_MS} ms at a time`,
  );
  const from = before.predators[subject];
  const to = after.predators[subject];
  assertGreaterThan(
    Math.hypot(to.x - from.x, to.y - from.y),
    TRAVELLED_MIN,
    `logical units the released ${from.kind} covered over the same watch, ` +
      `down a corridor with rock behind it (the slowest thing on this board ` +
      `travels at DRIFTER_SPEED, ${DRIFTER_SPEED})`,
  );
});
