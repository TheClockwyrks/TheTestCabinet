// paddle/angle-wraps — a held rotation carried across 0 or 360 keeps the
// deflector circling the track, its center angle wrapping modulo 360 and
// reading in [0, 360).
//
// specs/deflector-and-ball.md: "The angle wraps modulo `360`, so the deflector
// circles the track without limit in either direction", and
// specs/instrumentation.md fixes the snapshot's `paddle.angleDeg` as
// "normalized into `[0, 360)`". One hold is carried up across 360 and one down
// across 0, and wrapping is read tick over tick as three things: every reading
// stays in [0, 360); the hold actually carries across the boundary, landing on
// its far side; and the motion runs straight through it — every held tick
// moves the angle by the same wrap-aware step, in the held direction, so the
// landing is the modulo-360 image of the arithmetic sum. A build that clamps
// at the boundary stalls short of it, one that lets the angle run past the
// range reads outside it, and one that jumps at the crossing breaks the step.
//
// HOW FAR one held tick moves the deflector is paddle/rotation-speed's item,
// not this one's, so the step is read off the build's own ticks rather than
// restated from the 270 figure: a build that wraps correctly at the wrong
// rate fails that item and passes this one, and a build that turns at 270 but
// clamps fails this one alone.
//
// THE WORLD IS THE DEFLECTOR ALONE: an isolated playing field holding no ball,
// no target, and no pod, so nothing but the deflector answers the held key.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertCloseTo,
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertLessThan,
} from "../assert";
import { angularOffset } from "../constants";
import { captureReplay, isolate, openHarness, type Harness } from "../harness";
import { anglesUnderHold } from "./readings";

/**
 * Ten held ticks: at the spec's 270 degrees per second that is 45 degrees of
 * travel, carrying a pose 10 degrees short of the boundary well across it.
 */
const HELD_TICKS = 10;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h.dispose();
});

/**
 * Every reading stays normalized, the hold lands on the far side of the
 * boundary from `start`, and every tick's wrap-aware step matches the first
 * in size and carries the held `direction`'s sign (+1 rising, -1 falling).
 */
function assertWrapped(
  start: number,
  angles: readonly number[],
  direction: 1 | -1,
): void {
  const steps: number[] = [];
  let previous = start;
  for (const [tick, angle] of angles.entries()) {
    assertGreaterThanOrEqual(angle, 0, `the reading on held tick ${tick + 1}`);
    assertLessThan(angle, 360, `the reading on held tick ${tick + 1}`);
    steps.push(angularOffset(previous, angle));
    previous = angle;
  }

  const landing = angles[angles.length - 1];
  if (direction === 1) {
    assertLessThan(
      landing,
      start,
      "the rising hold's landing, carried across 360 to below where it began",
    );
  } else {
    assertGreaterThan(
      landing,
      start,
      "the falling hold's landing, carried across 0 to above where it began",
    );
  }

  const step = steps[0];
  assertGreaterThan(
    step * direction,
    0,
    "the first held tick's step, in the held direction",
  );
  for (const [tick, taken] of steps.entries()) {
    assertCloseTo(
      taken,
      step,
      3,
      `the step held tick ${tick + 1} took, matching the first tick's straight through the boundary`,
    );
  }
}

it("carries a rising hold across 360 and keeps reading in [0, 360)", async () => {
  await isolate(h);
  await h.debug.setPaddleAngle(350);

  const angles = await captureReplay(h, "wrap-up", () =>
    anglesUnderHold(h, "ArrowRight", HELD_TICKS),
  );

  assertWrapped(350, angles, 1);
});

it("carries a falling hold across 0 and keeps reading in [0, 360)", async () => {
  await isolate(h);
  await h.debug.setPaddleAngle(10);

  const angles = await captureReplay(h, "wrap-down", () =>
    anglesUnderHold(h, "ArrowLeft", HELD_TICKS),
  );

  assertWrapped(10, angles, -1);
});
