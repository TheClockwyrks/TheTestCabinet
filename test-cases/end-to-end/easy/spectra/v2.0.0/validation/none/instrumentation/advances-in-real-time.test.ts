// Spectra — instrumentation/advances-in-real-time: handed back its own clock, the
// game advances itself, with nothing stepping it.
//
// `specs/instrumentation.md` fixes both halves of the clock under this engine:
// "`setAutoStep(false)` stops the frame loop advancing the simulation from the
// wall clock, so the game changes only when `advance` says so.
// `setAutoStep(true)` returns it to running itself, WHICH IS HOW A BUILD STARTS
// AND HOW IT IS PLAYED." Every other point in this suite runs with the first of
// those in force, which is exactly why this one is here: a build whose simulation
// only ever moves when a validator calls `advance` would pass every one of them
// and be unplayable, and this is the point that catches it.
//
// SO THIS IS THE ONE READING IN THE PROJECT TAKEN OFF THE WALL CLOCK. The game is
// handed back to its own frame loop, real time is allowed to pass until the
// build's own clock says the game has moved, and the loop is taken away again.
// Nothing is stepped in between: whatever moved, moved because the build's own
// loop measured a frame and ran an update with it.
//
// WHAT IS READ, AND WHY BOTH. `simTime` "accumulates the time the game's sub-steps
// cover" (`specs/instrumentation.md`), so a build whose loop runs is one whose
// `simTime` rises; and a posed diving drone has left the point it was posed at, so
// a build that merely accumulates a clock without stepping the world is caught
// too. Neither reading on its own decides it.
//
// NOTHING HERE MEASURES A RATE, AND THAT IS DELIBERATE. What a browser's frame
// loop delivers in a given stretch of real time is the machine's business, not
// the build's, so the wait ends the moment the build's OWN clock says the game
// moved rather than after a fixed stretch of the wall clock: on a quiet host it
// is over in a few frames, and on one running a hundred other jobs it simply
// takes longer to get there. The bars are set where nothing-happened ends rather
// than at any figure: a tenth of a second on the clock, and a single logical unit
// of travel. A build running at a tenth of the frame rate of the machine next
// door passes here, and `swarm/dive-speed` is what grades the dive against
// `DIVE_SPEED`.
//
// THE FIELD IS OTHERWISE EMPTY AND QUIET. `startPosed` clears the four rosters and
// shuts the three world gates, so nothing arrives during the wait that could move
// the reading, and the diver flies with its fire gated off so no bullet it spawns
// can reach the ship and end the run mid-wait.
//
// WHAT THIS DOES NOT DECIDE. Not that `setAutoStep(false)` STOPS the loop — the
// whole of the rest of this project rests on that and would be undecidable if it
// did not hold — and not what a frame's delta is worth, which
// `instrumentation/deterministic-core` decides from the other side.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import {
  captureStill,
  createHarness,
  distance,
  poseDrone,
  requireDrone,
  startPosed,
  type Harness,
} from "../harness";

/** Where the diving drone starts: mid-field, clear of both HUD strips. */
const DIVER_AT = { x: 640, y: 220 } as const;

/**
 * The game time the build's own loop must accumulate, in seconds, for the wait to
 * be over.
 *
 * A tenth of a second, which a loop running at any frame rate at all reaches in a
 * handful of frames. It is set where "the clock never moved" ends rather than at
 * any frame rate, which is the machine's business and not the specification's.
 */
const SIM_MIN = 0.1;

/**
 * The most real time the build's loop is given to get there, in milliseconds.
 *
 * A bound on the wait, not a figure the build is measured against: a browser
 * delivering frames at all covers `SIM_MIN` in a fraction of a second, and this
 * stands two orders of magnitude above that so a starved host lengthens the wait
 * instead of failing a build that is running perfectly well. Reaching it means
 * the loop never ran.
 */
const DEADLINE_MS = 30_000;

/**
 * The least the diving drone must have travelled over that wait, in logical
 * units.
 *
 * One unit. `specs/swarm.md` flies a dive at `DIVE_SPEED` (`300`) units per
 * second, so the `SIM_MIN` of game time the wait runs for covers `30` units: this
 * is well under the figure, and it reads that the world moved while
 * `swarm/dive-speed` reads how fast.
 */
const MOVED_MIN = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("advances itself while it holds its own clock", async () => {
  await startPosed(h);
  const diver = await poseDrone(h, "shard", DIVER_AT.x, DIVER_AT.y, {
    band: "cyan",
    phase: "diving",
    travel: true,
    fire: false,
  });

  // One frame, so the canvas shows the posed field rather than the one before it.
  await h.advance(1);
  const before = await h.snapshot();
  await captureStill(h, "before");
  const posed = requireDrone(before, diver, "the drone posed into its dive");

  // The wait: the build's own loop, and nothing else, until the build's own clock
  // says the game has moved.
  await h.runUntil((s) => s.simTime - before.simTime > SIM_MIN, {
    deadlineMs: DEADLINE_MS,
  });

  const after = await h.snapshot();
  await captureStill(h, "after");

  assertGreaterThan(
    after.simTime - before.simTime,
    SIM_MIN,
    `the game time that accumulated over up to ${String(DEADLINE_MS)} ms of ` +
      `real time with the game on its own clock — setAutoStep(true) returns it ` +
      `to running itself (specs/instrumentation.md)`,
  );

  const moved = requireDrone(after, diver, "the drone posed into its dive");
  assertGreaterThan(
    distance(moved, posed),
    MOVED_MIN,
    `how far the diving drone travelled over that same wait, from the ` +
      `(${posed.x.toFixed(1)}, ${posed.y.toFixed(1)}) it stood at — a clock ` +
      `that rises over a world that never steps is not the game advancing ` +
      `itself`,
  );
});
