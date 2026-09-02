// stages/scaling-flux-hold — a Flux's held window shortens with the stage.
//
// specs/stages.md, Scaling: `fluxHold(stage)` is
// `max(1.0, FLUX_HOLD_L1 - 0.05 * (stage - 1))` seconds, with `FLUX_HOLD_L1`
// (1.6), and it is "the held part of a Flux's band window in specs/drones.md".
// specs/drones.md runs that window in two parts — below `fluxHold(stage)` the Flux
// is holding its stored band, at or above it the Flux is shimmering — so the held
// window at stage 10 is `fluxHold(10)`, 1.15 s.
//
// WHY STAGE TEN. The ramp reaches its 1.0 s floor at stage 13, so ten is inside
// it, and the three answers are far apart: a build that never scales the hold
// reads 1.60 s, one already on the floor reads 1.00 s, and the stated figure is
// 1.15 s. `drones/flux-cycle-holds` grades the same window at stage 1, so a build
// with a correct stage-1 hold and no scaling passes there and fails here — which
// is the split the two points are for. `stages/scaling-flux-hold-floor` grades
// where the ramp stops.
//
// WHAT IS DRIVEN. One Flux alone, its band clock at 0, with the OSCILLATION gate
// on and travel and fire off — the isolation specs/instrumentation.md was designed
// for: the band clock is the only thing moving, so the drone is where it was put a
// whole window later. Nothing about the shimmer is posed; the sweep watches for the
// build's own `shimmer` to turn true and reads the game time that took.
//
// WHY THE TRANSITION IS WATCHED FOR RATHER THAN THE CLOCK READ BACK. `shimmer` is
// derived from the band clock and the stage, so reading the clock would grade the
// arithmetic of a field this check already set. Sweeping to the transition grades
// what the player experiences: how long the drone is killable at a late stage.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertCloseTo, assertEqual } from "../assert";
import { FORM_CENTER_X, fluxHold, fluxWindow } from "../constants";
import {
  captureStill,
  createHarness,
  framesFor,
  poseDrone,
  requireDrone,
  seconds,
  startPosed,
  type Harness,
} from "../harness";

/** The stage the scenario is posed at: the hold is stated per stage. */
const STAGE = 10;

/** The hold `specs/stages.md` states at this stage: `fluxHold(10)` = 1.15 s. */
const HOLD = fluxHold(STAGE);

/** The band the Flux is posed holding, which is not `addDrone`'s default cyan. */
const POSED_BAND = "magenta" as const;

/** Where the Flux stands. Mid-field, clear of both HUD strips and of the ship. */
const AT = { x: FORM_CENTER_X, y: 300 } as const;

/**
 * How far the measured hold may sit from `fluxHold(10)`, as a fraction.
 *
 * The manifest's own figure, and an honest one: `specs/stages.md` fixes the hold
 * exactly, and the tolerance covers only how a build divides a frame into
 * sub-steps (`SUBSTEP_MAX`, specs/simulation.md) and where inside a frame it
 * decides the window turned over. 10% of 1.15 s is 0.115 s, which is well clear of
 * both wrong answers: an unscaled hold reads 1.60 s and a floored one 1.00 s.
 */
const TOLERANCE = 0.1;

/**
 * Decimal places the derived Flux hold itself must agree to.
 *
 * Six, which is exact for this purpose: `fluxHold(stage)` is a formula the
 * specification states to two decimals and specs/instrumentation.md has the
 * snapshot report it "derived at the call from `stage` by the formulas in
 * specs/stages.md", so the only slack a build can honestly need is the last bits
 * of a double. Reading it at the stage this point works at is what separates a
 * ramp that runs one step ahead of the stated one — a build using
 * `FLUX_HOLD_L1 - 0.05 * stage` reads 1.10 s where the specification says
 * 1.15 s, which the band above admits and this does not, and
 * `stages/scaling-flux-hold-floor` reads the same field only where the formula has
 * saturated and every ramp reads alike.
 */
const SCALE_DIGITS = 6;

/**
 * One frame of the harness's 100 Hz clock, added to each end of the bound.
 *
 * The sweep reads `shimmer` once per frame, so the instant it reports is the frame
 * boundary at or after the true transition. That quantum is the harness's, not the
 * build's, so it is allowed on top of the specification's tolerance rather than out
 * of it.
 */
const SAMPLE = seconds(1);

/**
 * Frames the sweep may run before it gives up.
 *
 * A whole band window at this stage, `fluxWindow(10)` = 1.55 s, plus 20%: a build
 * that never shimmers is reported as a hold longer than the window rather than
 * hanging. It also clears the unscaled hold of 1.6 s, so a build that simply never
 * scales is measured and named rather than timing out.
 */
const SWEEP_FRAMES = framesFor(Math.max(fluxWindow(STAGE), 1.6) * 1.2);

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("holds a stage-ten Flux's band for fluxHold(10) before the shimmer", async () => {
  await startPosed(harness, { stage: STAGE });
  assertCloseTo(
    (await harness.snapshot()).fluxHold,
    fluxHold(STAGE),
    SCALE_DIGITS,
    `the Flux hold the game derives at stage ${STAGE}, ` +
      "max(1.0, FLUX_HOLD_L1 - 0.05 * (stage - 1)) (specs/stages.md), which is the figure the " +
      "reading below has to be taken under",
  );
  const flux = await poseDrone(harness, "flux", AT.x, AT.y, {
    band: POSED_BAND,
    bandClock: 0,
    oscillation: true,
  });

  const shimmered = await harness.until(
    (snapshot) => requireDrone(snapshot, flux).shimmer,
    { maxFrames: SWEEP_FRAMES, poll: 1 },
  );
  await captureStill(harness, "shorter");

  assertBetween(
    seconds(shimmered.frames),
    HOLD * (1 - TOLERANCE) - SAMPLE,
    HOLD * (1 + TOLERANCE) + SAMPLE,
    `the seconds a Flux holds its band before shimmering at stage ${STAGE}, fluxHold(${STAGE}) (specs/stages.md, specs/drones.md)`,
  );
  assertEqual(
    requireDrone(shimmered.snapshot, flux).band,
    POSED_BAND,
    "the band the Flux held for the whole window it entered on (specs/drones.md)",
  );
});
