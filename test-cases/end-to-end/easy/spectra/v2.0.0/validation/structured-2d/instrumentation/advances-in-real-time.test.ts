// instrumentation/advances-in-real-time — handed to its own frame loop, the game
// advances itself, with nothing stepping it.
//
// Every other point in this suite drives the game with `engine.advance`, which
// runs frames back to back with no host frame callback in between (engine docs,
// frame.md). A build whose world only ever moved when a validator called `advance`
// would pass every one of them and be unplayable, and this is the point that
// catches it: the game is handed to `engine.run`, which "drives frames off the
// host's frame callback", left alone until the build's own clock says the game
// has moved, and then the loop is halted.
//
// SO THIS IS THE ONE READING IN THE PROJECT TAKEN OFF THE WALL CLOCK. Nothing is
// stepped in between: whatever moved, moved because the engine's own loop
// delivered frames and the build's own tick ran with them.
//
// WHAT IS READ, AND WHY BOTH. `simTime` "accumulates the time the game's sub-steps
// cover" (specs/instrumentation.md), so a build whose tick runs is one whose
// `simTime` rises; and a posed diving drone has left the point it was posed at, so
// a build that merely accumulates a clock without stepping the world is caught
// too. Neither reading on its own decides it.
//
// NOTHING HERE MEASURES A RATE, AND THAT IS DELIBERATE. How many frames a host's
// frame callback delivers in a given stretch of real time is the machine's
// business, not the build's, so the wait ends the moment the build's OWN clock
// says the game moved rather than after a fixed stretch of the wall clock: on a
// quiet host it is over in a few frames, and on one running a hundred other jobs
// it simply takes longer to get there. The bars below are set where
// nothing-happened ends rather than at any figure: a twentieth of a second on the
// clock, and a single logical unit of travel. `swarm.dive-speed` is what grades
// the dive against `DIVE_SPEED`.
//
// THE FIELD IS OTHERWISE EMPTY AND QUIET. `startPosed` clears the four rosters and
// shuts the three world gates, so nothing arrives during the wait that could move
// the reading, and the diver flies with its fire gated off so no bullet it spawns
// can reach the ship and end the run mid-wait.
//
// WHAT THIS DOES NOT DECIDE. Not what a frame's delta is worth, which
// `instrumentation.elapsed-time-steps` decides from the other side, and not what a
// dive's path looks like, which is `swarm.dive-bends-toward-player`'s.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  distanceBetween,
  poseDrone,
  startPosed,
  type Harness,
} from "../harness";
import { requireDrone } from "./crowded-field";

/** Where the diving drone starts: mid-field, clear of both HUD strips. */
const DIVER_AT = { x: 640, y: 220 } as const;

/**
 * The most real time the build's loop is given, in milliseconds.
 *
 * A bound on the wait, not a figure the build is measured against: a host frame
 * callback delivering frames at all covers `SIM_MIN` in a fraction of a second,
 * and this stands orders of magnitude above that, so a starved host lengthens the
 * wait instead of failing a build that is running perfectly well. Reaching it
 * means the loop never ran.
 */
const DEADLINE_MS = 30_000;

/**
 * The game time the build's own loop must accumulate, in seconds, for the wait to
 * be over.
 *
 * A twentieth of a second, which is five frames of the harness's 100 Hz clock. A
 * host frame callback delivering frames at all reaches it in a fraction of a
 * second, so this is set where "the clock never moved" ends rather than at any
 * frame rate, which is the machine's business and not the specification's.
 */
const SIM_MIN = 0.05;

/**
 * The least the diving drone must have travelled over that wait, in logical
 * units.
 *
 * One unit. specs/swarm.md flies a dive at `DIVE_SPEED` (`300`) units per second,
 * so even the five frames above are fifteen units for a build that keeps to the
 * figure: this reads that the world moved, and `swarm.dive-speed` reads how fast.
 */
const MOVED_MIN = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("advances itself while the engine's own loop holds it", async () => {
  startPosed(h);
  const diver = poseDrone(h, "shard", DIVER_AT.x, DIVER_AT.y, {
    band: "cyan",
    phase: "diving",
    travel: true,
    fire: false,
  });

  // One frame, so the canvas shows the posed field rather than the one before it.
  await h.advance(1);
  const before = h.snapshot();
  captureStill(h, "before");
  const posed = requireDrone(before, diver, "the drone posed into its dive");

  // The wait: the engine's own frame loop, and nothing else, until the build's
  // own clock says the game has moved.
  await h.runUntil((s) => s.simTime - before.simTime > SIM_MIN, {
    deadlineMs: DEADLINE_MS,
  });

  const after = h.snapshot();
  captureStill(h, "after");

  assertGreaterThan(
    after.simTime - before.simTime,
    SIM_MIN,
    `the game time that accumulated over up to ${DEADLINE_MS} ms of real time ` +
      `with the engine's own frame loop running the game and nothing stepping ` +
      `it (engine docs, frame.md)`,
  );

  const moved = requireDrone(after, diver, "the drone posed into its dive");
  assertGreaterThan(
    distanceBetween(moved, posed),
    MOVED_MIN,
    `how far the diving drone travelled over that same wait, from the ` +
      `(${posed.x.toFixed(1)}, ${posed.y.toFixed(1)}) it stood at — a ` +
      `clock that rises over a world that never steps is not the game ` +
      `advancing itself`,
  );
});
