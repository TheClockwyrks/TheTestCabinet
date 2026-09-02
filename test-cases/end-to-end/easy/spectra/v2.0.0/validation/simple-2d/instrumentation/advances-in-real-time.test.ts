// instrumentation/advances-in-real-time — left on its own clock, the game advances
// itself, with nothing stepping it.
//
// specs/instrumentation.md rests the whole surface on a core that "advances from
// the elapsed time the game is handed, independent of a canvas, of the frame loop
// that measured it, and of wall-clock time", and hands the frame loop itself to
// the engine: "The clock, the keyboard, the audio bus, and the overlay belong to
// the simple-2d engine ... The engine advances the game frame by frame and can
// take it off real time."
//
// SO THIS IS THE ONE READING IN THE PROJECT TAKEN OFF THE WALL CLOCK. Every other
// point in this suite builds its harness over a `ConstantClock` and advances exact
// frames, which makes them all blind to one claim: a build whose simulation only
// ever moves when a validator calls `advance` would pass every one of them and be
// unplayable. Here the harness is built over a `WallClock` — the clock a shipped
// game runs under, where each frame's delta is the real time since the last one —
// the engine's own loop is started, REAL time is allowed to pass until the
// build's own clock says the game has moved, and the loop is stopped. Nothing is stepped in between: whatever moved, moved
// because the loop measured a frame and the build ran an update with it.
//
// WHAT IS READ, AND WHY BOTH. `simTime` "accumulates the time the game's sub-steps
// cover" (specs/instrumentation.md), so a build whose loop runs is one whose
// `simTime` rises; and a posed diving drone has left the point it was posed at, so
// a build that merely accumulates a clock without stepping the world is caught
// too. Neither reading on its own decides it.
//
// NOTHING HERE MEASURES A RATE, AND THAT IS DELIBERATE. What a frame loop delivers
// in a given stretch of real time is the machine's business, not the build's, so
// the wait ends the moment the build's OWN clock says the game moved rather than
// after a fixed stretch of the wall clock: on a quiet host it is over in a few
// frames, and on one running a hundred other jobs it simply takes longer to get
// there. The bars below are set where nothing-happened ends rather than at any
// figure: a tenth of a second on the clock, and a single logical unit of travel. A
// build running at a tenth of the frame rate of the machine next door passes here,
// and `swarm/dive-speed` is what grades the dive against `DIVE_SPEED`.
//
// THE FIELD IS OTHERWISE EMPTY AND QUIET. `startPosed` clears the four rosters and
// shuts the three world gates, so nothing arrives during the wait that could move
// the reading, and the diver flies with its fire gated off so no bullet it spawns
// can reach the ship and end the run mid-wait.
//
// WHAT THIS DOES NOT DECIDE. What a frame's delta is worth, which
// `instrumentation/deterministic-core` decides from the other side.

import { WallClock } from "@test-cabinet/simple-2d";
import { afterEach, beforeEach, it } from "vitest";
import { DIVE_SPEED } from "../constants";
import { assertEqual, assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  distance,
  droneOf,
  poseDrone,
  startPosed,
  type Harness,
} from "../harness";

/** Where the diving drone starts: mid-field, clear of both HUD strips. */
const DIVER_AT = { x: 640, y: 220 } as const;

/**
 * The game time the build's own loop must accumulate, in seconds, for the wait to
 * be over.
 *
 * A tenth of a second. A build whose loop runs at all covers it in a handful of
 * frames, so it is set where "the clock never moved" ends rather than at any frame
 * rate, which is the machine's business and not the specification's.
 */
const SIM_MIN = 0.1;

/**
 * The most real time the build's loop is given, in milliseconds.
 *
 * A bound on the wait, not a figure the build is measured against: a frame loop
 * delivering frames at all covers `SIM_MIN` in a fraction of a second, and this
 * stands orders of magnitude above that, so a starved host lengthens the wait
 * instead of failing a build that is running perfectly well. Reaching it means the
 * loop never ran.
 */
const DEADLINE_MS = 30_000;

/**
 * The least the diving drone must have travelled over that wait, in logical units.
 *
 * One unit. specs/swarm.md flies a dive at `DIVE_SPEED` (`300`) units per second,
 * so the `SIM_MIN` of game time the wait runs for covers `30` units: this is well
 * under the figure, and it reads that the world moved while `swarm/dive-speed`
 * reads how fast.
 */
const MOVED_MIN = 1;

/**
 * One frame, run so the canvas holds a drawn picture before the first still.
 *
 * Under a `WallClock` this frame's delta is zero — the clock reports no elapsed
 * time for its first tick — so it renders and advances nothing.
 */
const PAINT_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  // The clock is the point, so this harness runs on the one a shipped game runs
  // on. Under it `advance(n)` no longer means `n` frames of fixed length, which is
  // why nothing below advances anything but the paint frame.
  h = await createHarness({ clock: new WallClock() });
});

afterEach(() => {
  h?.dispose();
});

it("advances itself while the engine's own loop holds the clock", async () => {
  startPosed(h);
  const diver = poseDrone(h, "shard", DIVER_AT.x, DIVER_AT.y, {
    band: "cyan",
    phase: "diving",
    travel: true,
    fire: false,
  });

  await h.advance(PAINT_FRAMES);
  const before = h.snapshot();
  captureStill(h, "before");
  assertEqual(
    before.screen,
    "inWave",
    "the wave the clock is handed to is live, so there is something running " +
      "to observe",
  );
  const posed = droneOf(before, diver);

  // The wait: the engine's own loop driving the build, and nothing else, until
  // the build's own clock says the game has moved.
  await h.runUntil((s) => s.simTime - before.simTime > SIM_MIN, {
    deadlineMs: DEADLINE_MS,
  });

  const after = h.snapshot();
  captureStill(h, "after");

  assertGreaterThan(
    after.simTime - before.simTime,
    SIM_MIN,
    `the game time that accumulated over up to ${String(DEADLINE_MS)} ms of ` +
      "real time with the engine's own frame loop running and nothing stepping " +
      "the game (specs/instrumentation.md)",
  );

  const moved = droneOf(after, diver);
  assertGreaterThan(
    distance(moved, posed),
    MOVED_MIN,
    `how far the diving drone travelled over that same wait, from the ` +
      `(${posed.x.toFixed(1)}, ${posed.y.toFixed(1)}) it stood at — ` +
      `a dive travels at DIVE_SPEED (${String(DIVE_SPEED)}) units per second ` +
      "(specs/swarm.md), and a clock that rises over a world that never steps " +
      "is not the game advancing itself",
  );
});
