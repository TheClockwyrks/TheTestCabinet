// paddle/both-held-no-motion — with ArrowLeft and ArrowRight held together,
// the deflector's center angle holds its value.
//
// specs/deflector-and-ball.md: "While `ArrowLeft` or `KeyA` is held, the
// center angle falls at `270` degrees per second; while `ArrowRight` or
// `KeyD` is held, it rises at `270` degrees per second." Both held at once is
// both rules in force: equal and opposite rates whose sum moves the center
// angle nowhere. The angle is sampled every 10 ticks across a 30-tick double
// hold and must read where it started each time, to float slack only — a
// build that lets one direction win, or alternates whole ticks of each, drifts
// 4.5 degrees per tick and is caught at the first sample.
//
// THE WORLD IS THE DEFLECTOR ALONE: an isolated playing field holding no ball,
// no target, and no pod, so nothing but the deflector answers the held keys.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo } from "../assert";
import { captureReplay, isolate, openHarness, type Harness } from "../harness";

/** How long both keys stay down, and how often the angle is read. */
const HELD_TICKS = 30;
const SAMPLE_EVERY = 10;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("holds its value with ArrowLeft and ArrowRight held together", async () => {
  const posed = isolate(h);
  const start = posed.paddle.angleDeg;

  h.holdKey("ArrowLeft");
  h.holdKey("ArrowRight");
  try {
    const samples = await captureReplay(h, "both-held", async () => {
      const angles: number[] = [];
      for (let held = 0; held < HELD_TICKS; held += SAMPLE_EVERY) {
        angles.push((await h.tick(SAMPLE_EVERY)).paddle.angleDeg);
      }
      return angles;
    });

    for (const [sample, angle] of samples.entries()) {
      assertCloseTo(
        angle,
        start,
        6,
        `the center angle after ${(sample + 1) * SAMPLE_EVERY} double-held ticks`,
      );
    }
  } finally {
    h.releaseKey("ArrowLeft");
    h.releaseKey("ArrowRight");
  }
});
