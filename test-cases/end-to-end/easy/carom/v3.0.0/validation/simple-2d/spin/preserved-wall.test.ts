// spin/preserved-wall — spin survives a wall bounce, less only its decay.
//
// "A wall bounce leaves speed and spin unchanged" (specs/balls.md). So across
// the bounce the spin changes by the decay alone:
// `spin_after = spin_before * 0.5 ^ (elapsed / SPIN_HALFLIFE)`,
// with `elapsed` the simulation time between the two readings, which the
// snapshot's own `simTime` gives.
//
// A spinning ball is posed on a climb into the top wall on a field holding that
// ball alone: both obstacles are removed rather than climbed past, and both
// paddles are driven off the line, so the only thing the flight meets is the
// wall. The spin is read on the frame the normal component reverses.

import { afterEach, beforeEach, it } from "vitest";
import { SPIN_HALFLIFE } from "../constants";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import {
  arrangeLiveBall,
  ball0,
  captureReplay,
  createHarness,
  spinBall,
  type Harness,
} from "../harness";

const POSED_SPIN = 300;
/** The review item's margin: two percent of the decayed spin. */
const RELATIVE_TOLERANCE = 0.02;
/** Frames recorded after the reading, so the clip shows the ball leaving. */
const DEPARTURE_TICKS = 60; // 0.5 s

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(() => {
  harness?.dispose();
});

it("keeps the spin through a wall bounce, less the decay", async () => {
  arrangeLiveBall(harness, { x: 300, y: 150, vx: 300, vy: -400 });
  spinBall(harness, POSED_SPIN);
  const before = harness.snapshot();

  const bounce = await captureReplay(harness, "bounce", async () => {
    const reflected = await harness.until((s) => ball0(s).vy > 0, {
      maxFrames: 240,
      poll: 1,
    });
    await harness.advance(DEPARTURE_TICKS);
    return reflected;
  });

  assertEqual(bounce.hit, true);
  const elapsed = bounce.snapshot.simTime - before.simTime;
  const expected = ball0(before).spin * Math.pow(0.5, elapsed / SPIN_HALFLIFE);
  assertLessThanOrEqual(
    Math.abs(ball0(bounce.snapshot).spin - expected),
    Math.abs(expected) * RELATIVE_TOLERANCE,
  );
});
