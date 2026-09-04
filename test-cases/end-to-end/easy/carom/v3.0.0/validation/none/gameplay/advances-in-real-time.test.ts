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
//
// THE FIELD HOLDS ONE BALL AND NOTHING ELSE. What the watch must show is a body
// moving under the build's own clock, so the obstacles come off the field and
// the paddles are moved out of the lane: the ball is posed travelling level down
// an empty field with a clear second of flight ahead of it — four times the
// quarter second the watch waits on — and neither a bank nor a contact nor a
// scored point can shorten the straight line the travel below is measured
// across.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import { FIELD_CY, SERVE_SPEED } from "../constants";
import {
  arrangeLiveBall,
  ball0,
  captureStill,
  createHarness,
  TICK_HZ,
  type Harness,
} from "../harness";

/**
 * The posed flight: level, at the serve speed, starting far enough down the
 * field that a whole second of it stays clear of the left goal — and the watch
 * below asks for a quarter of that.
 */
const BALL = { x: 1150, y: FIELD_CY, vx: -SERVE_SPEED, vy: 0 };
/**
 * The floor the game's own clock must clear, in seconds: thirty frames at the
 * suite's step. Enough that neither a single stray frame nor rounding can reach
 * it, and small enough that a badly loaded machine still gets a running build
 * there well inside the watch's ceiling. A frozen build reports 0.
 */
const MIN_ADVANCE = 30 / TICK_HZ;
/**
 * The floor the ball must travel, in logical px. It is posed at the serve speed
 * on a field emptied of everything that could turn it, so over
 * {@link MIN_ADVANCE} of game time a straight-line flight covers
 * `SERVE_SPEED * MIN_ADVANCE`; the floor takes a fraction of that, since what it
 * witnesses is that the simulation moved at all rather than how far it got.
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
  await arrangeLiveBall(harness, BALL, "solo");

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
