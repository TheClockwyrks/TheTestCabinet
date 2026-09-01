// stages/scaling-drone-speed-cap — the drone-speed scale stops at its cap.
//
// specs/stages.md, Scaling: `droneSpeedScale(stage)` is
// `min(1.50, 1 + 0.06 * (stage - 1))`, "Capped at `1.50`". The ramp reaches the cap
// at stage 9 and everything past it reads the same figure.
// specs/instrumentation.md reports it as the snapshot's `droneSpeedScale`, derived
// at the call from `stage` "by the formulas in specs/stages.md".
//
// WHAT IS DRIVEN. Nothing but the stage number: the cap is a property of the
// formula, and `stages/scaling-drone-speed` is the point that measures a drone
// actually moving at the figure. Grading the cap by driving a dive would need a
// dive at stage 20 and another at stage 40 to agree to within the measurement's
// own noise, which is a weaker reading of a sharper rule.
//
// WHY TWENTY AND FORTY. Both are far past the stage the ramp saturates at, and
// they are twenty stages apart, so a build that never capped reads 2.14 at one and
// 3.34 at the other, a build that capped at the wrong value reads that value
// twice, and a build that capped but kept creeping reads two different numbers.
// Neither is a challenge stage, so nothing about the flyover's unscaled figures is
// in play.

import { afterEach, beforeEach, it } from "vitest";
import { assertCloseTo } from "../assert";
import {
  captureStill,
  createHarness,
  startPosed,
  type Harness,
} from "../harness";

/** The two late stages the cap is read at. */
const LATE_STAGES = [20, 40] as const;

/** The capped figure specs/stages.md states: `min(1.50, …)`. */
const CAP = 1.5;

/**
 * Decimal places the reading must agree to.
 *
 * Six, which is exact for this purpose: the figure is a fixed constant the
 * specification states to two decimals, not a measurement, so the only slack a
 * build can honestly need is the last bits of a double.
 */
const DIGITS = 6;

/** Frames run before the picture is kept, so the canvas carries the late stage. */
const SETTLE_FRAMES = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("caps the drone-speed scale at 1.50 however late the stage", async () => {
  startPosed(h);

  for (const stage of LATE_STAGES) {
    h.debug.setStage(stage);
    assertCloseTo(
      h.snapshot().droneSpeedScale,
      CAP,
      DIGITS,
      `droneSpeedScale at stage ${String(stage)}, ` +
        "min(1.50, 1 + 0.06 * (stage - 1)) (specs/stages.md)",
    );
  }

  await h.advance(SETTLE_FRAMES);
  captureStill(h, "capped");
});
