// pods/burn-up-no-effect — a pod whose center radius reaches 78 burns up:
// removed, and no effect applies.
//
// specs/pods.md: "In a tick where the pod's center radius reaches new_r <= 78,
// the pod burns up: it is removed ... A burn-up applies no effect." The pod is
// posed at radius 91, so the threshold falls between whole ticks (79 on tick
// six, 77 on tick seven) and the burn-up tick is decided with a whole unit
// clear of the boundary on each side. A widen pod is used so "no effect" is
// read off both the span (still the 48-degree baseline) and widen's own timer.
//
// THE WORLD IS THE ONE POD: no target, no ball, no shield, the pod posed away
// from the deflector's angle and already below the catch radius, so its whole
// flight is the fall and the burn.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertTrue } from "../assert";
import {
  BURNUP_RADIUS,
  DEFLECTOR_BASE_SPAN_DEG,
  POD_FALL_SPEED,
  TICK_HZ,
} from "../constants";
import {
  captureReplay,
  isolate,
  openHarness,
  spawnPodPolar,
  type Harness,
} from "../harness";

/** Below the catch radius, one unit off a whole tick of the threshold. */
const START_R = 91;
/** Away from the deflector's 90-degree start angle. */
const THETA = 300;
/** 91 falls past 78 between ticks 6 and 7 at 2 units per tick. */
const BURN_TICK = Math.ceil(
  (START_R - BURNUP_RADIUS) / (POD_FALL_SPEED / TICK_HZ),
);

let h: Harness;

beforeEach(async () => {
  h = await openHarness();
});

afterEach(() => {
  h?.dispose();
});

it("removes the pod at the burn-up radius and applies nothing", async () => {
  isolate(h);
  spawnPodPolar(h, "widen", START_R, THETA);

  await captureReplay(h, "burn-up", async () => {
    const swept = await h.until((s) => s.pods.length === 0, { maxTicks: 12 });
    assertTrue(swept.hit, "the pod burns up rather than falling forever");
    assertEqual(
      swept.ticks,
      BURN_TICK,
      "removed the tick its radius reaches 78 or less",
    );
    assertEqual(
      swept.snapshot.effects.widenTicks,
      0,
      "the kind's effect never starts",
    );
    assertEqual(
      swept.snapshot.paddle.spanDeg,
      DEFLECTOR_BASE_SPAN_DEG,
      "the span stands at its baseline",
    );
  });
});
