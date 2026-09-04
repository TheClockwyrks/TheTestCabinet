// gameplay/advances-in-real-time — the game runs itself off its own frame loop.
//
// WHY THIS CHECK EXISTS. Every other check in this suite drives the simulation
// itself, through the surface's `advance`, which is blind to this claim: a build
// whose game never advances unless something steps it would answer all of them
// perfectly while a person who opened it saw a frozen court. So this one alone
// never advances the measured stretch. It hands the game back to its own loop
// with `setAutoStep(true)`, lets REAL time pass while it reads nothing but the
// clock, takes the loop back, and reports what the build did with it.
//
// THAT IS THE WHOLE OF THE CONTRACT UNDER THIS ENGINE. Nothing outside an
// engineless build owns its loop: the build measured each frame's elapsed time
// off the wall clock, clamped it or did not, and integrated the game against it,
// and `setAutoStep` is the switch the specification puts on the surface so that
// the loop can be stopped and started from outside (specs/instrumentation.md).
// Handing it back is therefore the only way to see the loop the build wrote.
//
// TWO INDEPENDENT WITNESSES. The game's own accumulated `simTime`, which says the
// build integrated the elapsed seconds it measured, and the distance the ball
// covered, which says the SIMULATION ran rather than a counter ticking up.
//
// WHAT IS READ, AND WHAT IS NOT. The claim is that the game advances ITSELF while
// real time passes, not that it keeps pace with a stopwatch, so nothing here
// compares the game's clock against elapsed real time. The loop is left running
// until the game's OWN clock has gained {@link MIN_ADVANCE}, under a real-time
// ceiling far longer than any running build needs; a machine busy enough to
// starve the frame loop spends more of that ceiling rather than producing a
// smaller reading, and a build that never advances itself gains exactly nothing
// and is still the only thing that fails.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import { SERVE_SPEED } from "../constants";
import {
  ball0,
  captureStill,
  createHarness,
  TICK_HZ,
  type Harness,
} from "../harness";

/**
 * The floor the game's own clock must clear, in seconds: thirty frames at the
 * suite's step. Enough that neither a single stray frame nor rounding can reach
 * it, and small enough that a badly loaded machine still gets a running build
 * there well inside the watch's ceiling. A frozen build reports 0.
 */
const MIN_ADVANCE = 30 / TICK_HZ;
/**
 * The floor the ball must travel, in logical px. It leaves at the serve speed and
 * clears both the walls and the far paddle over {@link MIN_ADVANCE} of game time,
 * so a straight-line flight covers `SERVE_SPEED * MIN_ADVANCE`; the floor takes a
 * fraction of that, since what it witnesses is that the simulation moved at all.
 */
const MIN_TRAVEL = (SERVE_SPEED * MIN_ADVANCE) / 2.5;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("advances on its own frame loop with nothing stepping it", async () => {
  const { debug } = harness;
  await debug.startMatch("solo");
  await debug.serve();
  // One frame to let the build's own serve launch the ball, so the travel below
  // is measured on a ball already in flight.
  await harness.advance(1);

  const before = await harness.snapshot();
  await captureStill(harness, "before");
  assertGreaterThan(ball0(before).speed, 1);

  const watched = await harness.runUntil(
    (s) => s.simTime - before.simTime > MIN_ADVANCE,
  );

  const after = watched.snapshot;
  // The pair is the evidence: two frames of the same match, with nothing between
  // them but the build's own loop. A build that never advanced itself produces
  // two identical pictures.
  await captureStill(harness, "after");
  const advanced = after.simTime - before.simTime;
  const travelled = Math.hypot(
    ball0(after).x - ball0(before).x,
    ball0(after).y - ball0(before).y,
  );

  assertGreaterThan(advanced, MIN_ADVANCE);
  assertGreaterThan(travelled, MIN_TRAVEL);
});
