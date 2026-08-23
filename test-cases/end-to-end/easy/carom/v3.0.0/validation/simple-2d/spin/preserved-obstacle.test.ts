// spin/preserved-obstacle — spin survives an obstacle bounce, less only its decay.
//
// "An obstacle bounce leaves speed and spin unchanged" (specs/playfield.md). So across the bounce the spin changes by
// the decay alone: `spin_after = spin_before * 0.5 ^ (elapsed / SPIN_HALFLIFE)`,
// with `elapsed` the simulation time between the two readings, which the
// snapshot's own `simTime` gives. A spinning ball is posed level with obstacle A's left face, travelling at it, and the spin
// is read on the frame the normal component reverses.

import { afterEach, beforeEach, expect, it } from "vitest";
import { OBSTACLES, SPIN_HALFLIFE } from "../../src/constants";
import {
  arrangeLiveBall,
  ball0,
  captureReplay,
  createHarness,
  type Harness,
} from "../harness";

const POSED_SPIN = 200;
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

it("keeps the spin through an obstacle bounce, less the decay", async () => {
  await arrangeLiveBall(harness, {
    x: OBSTACLES[0].x0 - 180,
    y: 220,
    vx: 400,
    vy: 0,
  });
  harness.debug.setBall(0, { spin: POSED_SPIN });
  const before = harness.snapshot();

  const bounce = await captureReplay(harness, "bounce", async () => {
    const reflected = await harness.until((s) => ball0(s).vx < 0, {
      maxFrames: 240,
      poll: 1,
    });
    await harness.advance(DEPARTURE_TICKS);
    return reflected;
  });

  expect(bounce.hit).toBe(true);
  const elapsed = bounce.snapshot.simTime - before.simTime;
  const expected = ball0(before).spin * Math.pow(0.5, elapsed / SPIN_HALFLIFE);
  expect(Math.abs(ball0(bounce.snapshot).spin - expected)).toBeLessThanOrEqual(
    Math.abs(expected) * RELATIVE_TOLERANCE,
  );
});
