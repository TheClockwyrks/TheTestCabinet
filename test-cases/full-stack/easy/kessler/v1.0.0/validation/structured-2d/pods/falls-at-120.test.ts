// pods/falls-at-120 — a pod falls radially inward at 120 units per second,
// its center angle constant.
//
// specs/pods.md: "The pod falls radially inward at 120 units per second, its
// center angle constant." At the fixed 60 Hz timestep that is exactly 2 units
// of radius per tick, read at one tick, two ticks, and twelve ticks so a build
// that is right for a moment but drifts — or that falls at a framey rate
// rather than the fixed one — misses by whole units. The flight is posed far
// from every contact: no target, no ball, no shield, the deflector's span
// nowhere near the pod's angle, and every radius read above the catch radius.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo, assertLength } from "../assert";
import { POD_FALL_SPEED, TICK_HZ } from "../constants";
import {
  angularOffset,
  captureReplay,
  isolate,
  openHarness,
  spawnPodPolar,
  xyToPolar,
  type Harness,
} from "../harness";

/** Where the flight is posed: high above the catch radius, away from 90. */
const START_R = 400;
const THETA = 200;
/** The specification's fall, in units per tick: 120 / 60 = 2. */
const PER_TICK = POD_FALL_SPEED / TICK_HZ;

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("falls 2 units of radius per tick on a constant angle", async () => {
  isolate(h);
  spawnPodPolar(h, "widen", START_R, THETA);

  await captureReplay(h, "fall", async () => {
    let elapsed = 0;
    for (const step of [1, 1, 10]) {
      const snap = await h.tick(step);
      elapsed += step;
      assertLength(
        snap.pods,
        1,
        `the pod is still in flight at tick ${elapsed}`,
      );
      const p = xyToPolar(snap.pods[0].x, snap.pods[0].y);
      assertCloseTo(
        p.r,
        START_R - PER_TICK * elapsed,
        1,
        `the radius after ${elapsed} ticks`,
      );
      assertCloseTo(
        angularOffset(THETA, p.thetaDeg),
        0,
        1,
        `the center angle after ${elapsed} ticks`,
      );
    }
  });
});
