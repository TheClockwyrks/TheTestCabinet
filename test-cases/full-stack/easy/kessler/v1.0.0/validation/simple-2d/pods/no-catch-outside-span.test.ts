// pods/no-catch-outside-span — a pod whose center angle is outside the span
// when it crosses 196 is not caught and keeps falling inward.
//
// specs/pods.md catches only a crossing "with its center angle within the
// deflector's span", and the review item fixes the other direction: a pod
// outside the span "is not caught and keeps falling inward". The pod is posed
// 30 degrees off the deflector's center against the baseline span of 48 —
// 6 degrees beyond the 24-degree half-span, so no honest membership reading
// can include it — and read both on the tick after the crossing and three
// ticks later, still falling on its constant angle with its kind's effect
// never applied.
//
// THE WORLD IS THE POD AND THE DEFLECTOR ALONE: no target, no ball, both
// driver switches held off by the isolate pose.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertEqual, assertLength } from "../assert";
import { DEFLECTOR_BASE_SPAN_DEG, POD_FALL_SPEED, TICK_HZ } from "../constants";
import {
  angularOffset,
  captureReplay,
  isolate,
  openHarness,
  spawnPodPolar,
  xyToPolar,
  type Harness,
} from "../harness";

/** One unit above the catch radius plus two whole ticks of fall. */
const START_R = 201;
/** 30 degrees off the deflector's center: outside the 24-degree half-span. */
const OFFSET = 30;
const THETA = 90 + OFFSET;
/** The specification's fall, in units per tick: 120 / 60 = 2. */
const PER_TICK = POD_FALL_SPEED / TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("lets a pod outside the span fall past the catch radius", async () => {
  isolate(h);
  assertEqual(
    h.snapshot().paddle.spanDeg,
    DEFLECTOR_BASE_SPAN_DEG,
    "the baseline span is in force",
  );
  spawnPodPolar(h, "pierce", START_R, THETA);

  await captureReplay(h, "fall-past", async () => {
    const crossed = await h.tick(3);
    assertLength(crossed.pods, 1, "the crossing tick catches nothing");
    assertEqual(
      crossed.effects.pierceTicks,
      0,
      "the kind's effect never applies",
    );

    const later = await h.tick(3);
    assertLength(later.pods, 1, "the pod keeps falling past the deflector");
    const p = xyToPolar(later.pods[0].x, later.pods[0].y);
    assertCloseTo(
      p.r,
      START_R - PER_TICK * 6,
      1,
      "still 2 units inward per tick",
    );
    assertCloseTo(angularOffset(THETA, p.deg), 0, 1, "the angle held");
  });
});
