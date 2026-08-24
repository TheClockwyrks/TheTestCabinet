// gameplay/advances-in-real-time — the game runs itself off the runtime's own loop.
//
// WHY THIS CHECK EXISTS. Every other check in this suite drives the simulation
// itself, through `engine.advance`, which is blind to this claim: a build whose
// game never advances unless something steps it would answer all of them
// perfectly while a person who opened it saw a frozen court. So this one alone
// never calls `advance` for the measured stretch. It hands the runtime a
// `WallClock` and starts `engine.run`, which pumps frames off the host's frame
// callback in real time, and then reads what the build did with them.
//
// TWO INDEPENDENT WITNESSES. The game's own accumulated `simTime`, which says the
// build integrated the elapsed seconds it was handed, and the distance the ball
// covered, which says the SIMULATION ran rather than a counter ticking up.

import { afterEach, beforeEach, it } from "vitest";
import { WallClock } from "@test-cabinet/simple-2d";
import { SERVE_SPEED } from "../../src/constants";
import { assertGreaterThan } from "../assert";
import { ball0, captureStill, createHarness, type Harness } from "../harness";

/** The real-time window the loop is left to run for. */
const RUN_MS = 1000;
/**
 * The floor the game clock must clear, in seconds. Half the window, deliberately
 * generous: the claim is that the game advances ITSELF, not that it keeps perfect
 * time, and a build that clamps a long frame (ordinary spiral-of-death
 * protection) legally loses some. A build driving its own tick lands near 1.0; a
 * frozen one reports 0.
 */
const MIN_ADVANCE = RUN_MS / 1000 / 2;
/**
 * The floor the ball must travel, in logical px. It leaves at the serve speed, so
 * even a loop managing a fifth of real time carries it this far.
 */
const MIN_TRAVEL = (SERVE_SPEED * (RUN_MS / 1000)) / 5;

let harness: Harness;

beforeEach(async () => {
  // A real clock, because this is the one check about real elapsed time.
  harness = await createHarness({ clock: new WallClock() });
});

afterEach(() => {
  harness?.dispose();
});

it("advances on the runtime's frame loop with nothing stepping it", async () => {
  const { debug } = harness;
  debug.startMatch("solo");
  debug.serve();
  // One frame to let the build's own serve launch the ball, so the travel below
  // is measured on a ball already in flight.
  await harness.advance(1);

  const before = harness.snapshot();
  captureStill(harness, "before");
  assertGreaterThan(ball0(before).speed, 1);

  await harness.runFor(RUN_MS);

  const after = harness.snapshot();
  // The pair is the evidence: two frames of the same match, a second apart, with
  // nothing between them but the runtime's own loop. A build that never advanced
  // itself produces two identical pictures.
  captureStill(harness, "after");
  const advanced = after.simTime - before.simTime;
  const travelled = Math.hypot(
    ball0(after).x - ball0(before).x,
    ball0(after).y - ball0(before).y,
  );

  assertGreaterThan(advanced, MIN_ADVANCE);
  assertGreaterThan(travelled, MIN_TRAVEL);
});
