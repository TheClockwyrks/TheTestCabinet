// stages/scaling-dive-gap-floor — the dive-gap scale stops at its floor.
//
// specs/stages.md, Scaling: `diveGapScale(stage)` is
// `max(0.55, 1 - 0.05 * (stage - 1))`, "Floored at `0.55`". The ramp reaches the
// floor at stage 10 and everything past it reads the same figure.
// specs/instrumentation.md reports it as the snapshot's `diveGapScale`, derived at
// the call from `stage` "by the formulas in specs/stages.md".
//
// WHAT IS DRIVEN. Nothing but the stage number: the floor is a property of the
// formula, and `stages/scaling-dive-gap` is the point that measures dives actually
// launching at the figure. That measurement is a mean over twenty drawn gaps, so
// grading the floor the same way would ask two twenty-sample means to agree to
// within their own noise — a far weaker reading of a sharper rule.
//
// WHY TWENTY AND FORTY. Both are far past the stage the ramp bottoms out at, and
// they are twenty stages apart, so a build that never floored reads 0.05 at one
// and -0.95 at the other, a build that floored at the wrong value reads that value
// twice, and a build that floored but kept falling reads two different numbers.
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

/** The two late stages the floor is read at. */
const LATE_STAGES = [20, 40] as const;

/** The floored figure specs/stages.md states: `max(0.55, …)`. */
const FLOOR = 0.55;

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

it("floors the dive-gap scale at 0.55 however late the stage", async () => {
  startPosed(h);

  for (const stage of LATE_STAGES) {
    h.debug.setStage(stage);
    assertCloseTo(
      h.snapshot().diveGapScale,
      FLOOR,
      DIGITS,
      `diveGapScale at stage ${String(stage)}, ` +
        "max(0.55, 1 - 0.05 * (stage - 1)) (specs/stages.md)",
    );
  }

  await h.advance(SETTLE_FRAMES);
  captureStill(h, "floor");
});
