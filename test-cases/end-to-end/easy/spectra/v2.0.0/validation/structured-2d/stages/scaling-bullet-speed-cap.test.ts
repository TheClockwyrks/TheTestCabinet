// stages/scaling-bullet-speed-cap — the bullet-speed scale stops at its cap.
//
// specs/stages.md, Scaling: `bulletSpeedScale(stage)` is
// `min(1.40, 1 + 0.04 * (stage - 1))`, "Capped at `1.40`". The ramp reaches the cap
// at stage 11 and everything past it reads the same figure.
// specs/instrumentation.md reports it as the snapshot's `bulletSpeedScale`,
// derived at the call from `stage` "by the formulas in specs/stages.md".
//
// WHAT IS DRIVEN. Nothing but the stage number: the cap is a property of the
// formula, and `stages/scaling-bullet-speed` is the point that measures an enemy
// bullet actually falling at the figure. Grading the cap by dropping a bullet at
// stage 20 and another at stage 40 would ask two measurements to agree to within
// their own noise, which is a weaker reading of a sharper rule.
//
// WHY TWENTY AND FORTY. Both are far past the stage the ramp saturates at, and
// they are twenty stages apart, so a build that never capped reads 1.76 at one and
// 2.56 at the other, a build that capped at the wrong value reads that value
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

/** The capped figure `specs/stages.md` states: `min(1.40, …)`. */
const CAP = 1.4;

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

it("caps the bullet-speed scale at 1.40 however late the stage", async () => {
  startPosed(h);

  for (const stage of LATE_STAGES) {
    h.debug.setStage(stage);
    const snapshot = h.snapshot();
    assertCloseTo(
      snapshot.bulletSpeedScale,
      CAP,
      DIGITS,
      `bulletSpeedScale at stage ${stage}, min(1.40, 1 + 0.04 * (stage - 1)) (specs/stages.md)`,
    );
  }

  await h.advance(SETTLE_FRAMES);
  captureStill(h, "capped");
});
