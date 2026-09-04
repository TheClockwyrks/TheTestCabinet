// stages/scaling-flux-hold-floor — the Flux hold stops at its floor.
//
// specs/stages.md, Scaling: `fluxHold(stage)` is
// `max(1.0, FLUX_HOLD_L1 - 0.05 * (stage - 1))` seconds with `FLUX_HOLD_L1` (1.6),
// "Floored at `1.0`". The ramp reaches the floor at stage 13 and everything past
// it reads the same figure. specs/instrumentation.md reports it as the snapshot's
// `fluxHold`, "derived from stage, in seconds", by the formula in
// specs/stages.md.
//
// WHAT IS DRIVEN. Nothing but the stage number: the floor is a property of the
// formula, and `stages/scaling-flux-hold` is the point that watches a Flux
// actually hold its band for the figure. Grading the floor by sweeping a Flux at
// stage 20 and another at stage 40 would ask two sweeps to agree to within their
// own frame quantum, which is a weaker reading of a sharper rule.
//
// WHY TWENTY AND FORTY. Both are far past the stage the ramp bottoms out at, and
// they are twenty stages apart, so a build that never floored reads 0.65 s at one
// and -0.35 s at the other, a build that floored at the wrong value reads that
// value twice, and a build that floored but kept falling reads two different
// numbers.

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

/** The floored hold `specs/stages.md` states, in seconds: `max(1.0, …)`. */
const FLOOR = 1.0;

/**
 * Decimal places the reading must agree to.
 *
 * Six, which is exact for this purpose: the figure is a fixed constant the
 * specification states to one decimal, not a measurement, so the only slack a
 * build can honestly need is the last bits of a double.
 */
const DIGITS = 6;

/** Frames run before the picture is kept, so the canvas carries the late stage. */
const SETTLE_FRAMES = 1;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("floors the Flux hold at 1.0 s however late the stage", async () => {
  await startPosed(harness);

  for (const stage of LATE_STAGES) {
    await harness.debug.setStage(stage);
    const snapshot = await harness.snapshot();
    assertCloseTo(
      snapshot.fluxHold,
      FLOOR,
      DIGITS,
      `fluxHold at stage ${stage}, max(1.0, FLUX_HOLD_L1 - 0.05 * (stage - 1)) (specs/stages.md)`,
    );
  }

  await harness.advance(SETTLE_FRAMES);
  await captureStill(harness, "floor");
});
