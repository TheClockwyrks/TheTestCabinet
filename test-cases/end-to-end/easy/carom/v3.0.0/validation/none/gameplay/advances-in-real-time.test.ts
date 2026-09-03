// gameplay/advances-in-real-time — the game runs itself off its own frame loop.
//
// WHY THIS CHECK EXISTS. Every other check in this suite drives the simulation
// itself, through the surface's `advance`, which is blind to this claim: a build
// whose game never advances unless something steps it would answer all of them
// perfectly while a person who opened it saw a frozen court. So this one alone
// never advances the measured stretch. It hands the game back to its own loop
// with `setAutoStep(true)`, lets a second of REAL time pass, takes the clock back,
// and reads what the build did with it.
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
// THE FIELD HOLDS ONE BALL AND NOTHING ELSE. What the second of real time must
// show is a body moving under the build's own clock, so the obstacles come off
// the field and the paddles are moved out of the lane: the ball is posed
// travelling level down an empty field with a clear second of flight ahead of it,
// and neither a bank nor a contact nor a scored point can shorten the straight
// line the travel below is measured across.

import { afterEach, beforeEach, it } from "vitest";
import { assertGreaterThan } from "../assert";
import { FIELD_CY, SERVE_SPEED } from "../constants";
import {
  arrangeLiveBall,
  ball0,
  captureStill,
  createHarness,
  type Harness,
} from "../harness";

/** The real-time window the loop is left to run for. */
const RUN_MS = 1000;
/**
 * The posed flight: level, at the serve speed, starting far enough down the
 * field that a whole second of it stays clear of the left goal.
 */
const BALL = { x: 1150, y: FIELD_CY, vx: -SERVE_SPEED, vy: 0 };
/**
 * The floor the game clock must clear, in seconds. Half the window, deliberately
 * generous: the claim is that the game advances ITSELF, not that it keeps perfect
 * time, and a build that clamps a long frame (ordinary spiral-of-death
 * protection) legally loses some. A build driving its own tick lands near 1.0; a
 * frozen one reports 0.
 */
const MIN_ADVANCE = RUN_MS / 1000 / 2;
/**
 * The floor the ball must travel, in logical px. It is posed at the serve speed,
 * so even a loop managing a fifth of real time carries it this far.
 */
const MIN_TRAVEL = (SERVE_SPEED * (RUN_MS / 1000)) / 5;

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

  await harness.runFor(RUN_MS);

  const after = await harness.snapshot();
  // The pair is the evidence: two frames of the same match, a second apart, with
  // nothing between them but the build's own loop. A build that never advanced
  // itself produces two identical pictures.
  await captureStill(harness, "after");
  const advanced = after.simTime - before.simTime;
  const travelled = Math.hypot(
    ball0(after).x - ball0(before).x,
    ball0(after).y - ball0(before).y,
  );

  assertGreaterThan(advanced, MIN_ADVANCE);
  assertGreaterThan(travelled, MIN_TRAVEL);
});
