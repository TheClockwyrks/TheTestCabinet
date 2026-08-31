// instrumentation/set-paddle-angle — `setPaddleAngle(deg)` poses the
// deflector's center angle.
//
// specs/instrumentation.md, on `setPaddleAngle`: "Sets the deflector's center
// angle to `deg`, normalized into `[0, 360)`. A parked ball follows it to the
// new angle, and the span is untouched." specs/deflector-and-ball.md places
// the following parked ball "at radius `194` at the deflector's center angle".
//
// Three poses are read: an in-range angle, and one from each side of the
// range — `390` and `-30` — for the stated normalization. The parked ball's
// following and the untouched span are read on the in-range pose; the
// wrapped poses read the angle alone.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo } from "../assert";
import { captureStill, isolate, openHarness, type Harness } from "../harness";
import { assertParkedOnDeflector, SPAN_BASE } from "./helpers";

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("poses the angle normalized, the parked ball follows, the span holds", async () => {
  await isolate(h);
  await h.debug.parkBall();

  await h.debug.setPaddleAngle(200);
  const posed = await h.snapshot();
  await h.debug.setPaddleAngle(390);
  const above = await h.snapshot();
  await h.debug.setPaddleAngle(-30);
  const below = await h.snapshot();

  await h.tick(1);
  await captureStill(h, "posed-angle");

  assertCloseTo(posed.paddle.angleDeg, 200, 6, "the posed center angle");
  assertParkedOnDeflector(posed, "the parked ball, following the pose");
  assertCloseTo(posed.paddle.spanDeg, SPAN_BASE, 6, "the span, untouched");

  assertCloseTo(above.paddle.angleDeg, 30, 6, "390, normalized into [0, 360)");
  assertCloseTo(below.paddle.angleDeg, 330, 6, "-30, normalized into [0, 360)");
  assertParkedOnDeflector(below, "the parked ball, following the wrapped pose");
});
