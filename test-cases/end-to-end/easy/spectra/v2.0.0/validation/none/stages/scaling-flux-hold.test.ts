// stages/scaling-flux-hold — a Flux's held window shortens with the stage.
//
// specs/stages.md, Scaling: `fluxHold(stage)` is
// `max(1.0, FLUX_HOLD_L1 - 0.05 * (stage - 1))` seconds, with `FLUX_HOLD_L1`
// (`1.6`), and it is "the held part of a Flux's band window in specs/drones.md".
// specs/drones.md runs that window in two parts — below `fluxHold(stage)` the Flux
// is holding its stored band, at or above it the Flux is shimmering — so the held
// window at stage 10 is `fluxHold(10)`, 1.15 s.
//
// WHERE THE EXPECTATION COMES FROM. `validation/none/constants.ts`, which is the
// specification restated on this side and never a build's own copy of anything —
// the reason that file exists, and stated in its header. What changed here is the
// READING: the two below are both absolute, so a build whose shimmer predicate is
// one step out along the ramp is named rather than admitted by a wide band.
//
// WHY STAGE TEN. The ramp reaches its 1.0 s floor at stage 13, so ten is inside
// it, and the wrong answers are far apart: a build that never scales the hold reads
// 1.60 s, one already on the floor reads 1.00 s, one step out along the ramp reads
// 1.10 s, and the stated figure is 1.15 s. `drones/flux-cycle-holds` grades the
// same window at stage 1, so a build with a correct stage-1 hold and no scaling
// passes there and fails here — which is the split the two points are for.
// `stages/scaling-flux-hold-floor` grades where the ramp stops.
//
// THE HOLD IS READ TWICE, AND THE TWO READINGS ARE NOT THE SAME EVIDENCE.
//
//   The SWEEP is what a player lives: one Flux alone, its band clock at 0, with the
//   OSCILLATION gate on and travel and fire off — the isolation
//   specs/instrumentation.md was designed for, so the band clock is the only thing
//   moving and the drone is where it was put a whole window later. Nothing about
//   the shimmer is posed; the sweep watches for the build's own `shimmer` to turn
//   true and reads the game time that took. It grades the clock and the predicate
//   together, and it is bounded below by the frame the sweep samples on.
//
//   The PROBE is the boundary itself, read exactly. specs/instrumentation.md fixes
//   `shimmer` as "true exactly while `bandClock >= fluxHold(stage)`", so posing the
//   clock either side of the stated hold and reading the flag back settles where a
//   build's boundary lies with no measurement in it at all. A build one step out
//   along the ramp shimmers at 1.13 s, which the specification says is still held.
//
// Neither subsumes the other: a build with the right predicate and a clock that
// runs fast passes the probe and fails the sweep, and a build with an honest clock
// and a boundary one step out passes a loose sweep and fails the probe.

import { afterEach, beforeEach, it } from "vitest";
import {
  assertBetween,
  assertCloseTo,
  assertEqual,
  assertTrue,
} from "../assert";
import { FLUX_SHIMMER, fluxHold, FORM_CENTER_X } from "../constants";
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

/** The hold specs/stages.md states at this stage: `fluxHold(10)` = 1.15 s. */
const HOLD = fluxHold(STAGE);

/** The band the Flux is posed holding, which is not `addDrone`'s default cyan. */
const POSED_BAND = "magenta" as const;

/** Where the Flux stands. Mid-field, clear of both HUD strips and of the ship. */
const AT = { x: FORM_CENTER_X, y: 300 } as const;

/**
 * How far the swept hold may sit from `fluxHold(10)`, as a fraction.
 *
 * Two percent — 0.023 s at this stage — on top of the sample below, and it is a
 * measurement allowance rather than a licence on the hold. specs/simulation.md caps
 * a sub-step at `SUBSTEP_MAX` (1/120 s), so a build resolves the window's end
 * within a sub-step of where the specification puts it and the sweep sees it on the
 * next frame; the reference builds read the stated figure plus exactly one frame.
 *
 * What the band decides is which wrong models the sweep names, and at two percent
 * it names all of them: an unscaled hold reads 1.60 s, a floored one 1.00 s, and a
 * ramp one step out reads 1.10 s against a lower edge of 1.119 s. The 10% the
 * ratio-era band allowed took in that last model, which is why it is not kept.
 */
const TOLERANCE = 0.02;

/**
 * How far either side of the stated hold the boundary is probed, in seconds.
 *
 * Twenty milliseconds: far enough below `fluxHold(10)` that no build's arithmetic
 * lands on the wrong side of it by accident, and well inside the 0.05 s a single
 * step of the ramp is worth, so a build whose boundary is one step out is named by
 * it. The probe at the hold itself takes no offset — specs/instrumentation.md makes
 * `shimmer` true AT `fluxHold(stage)`, not past it.
 */
const PROBE_EPSILON = 0.02;

/**
 * Decimal places the derived Flux hold itself must agree to.
 *
 * Six, which is exact for this purpose: `fluxHold(stage)` is a formula the
 * specification states to two decimals and specs/instrumentation.md has the
 * snapshot report it "derived at the call from `stage` by the formulas in
 * specs/stages.md", so the only slack a build can honestly need is the last bits
 * of a double. This is the REPORTED figure, a requirement of its own rather than
 * the evidence the two readings below rest on.
 */
const SCALE_DIGITS = 6;

/**
 * One frame of the suite's clock, allowed at each end of the swept bound.
 *
 * The sweep reads `shimmer` once per frame, so the instant it reports is the frame
 * boundary at or after the true transition. That quantum is the harness's, not the
 * build's, so it is allowed on top of the specification's tolerance rather than
 * out of it.
 */
const SAMPLE = seconds(1);

/**
 * Frames the sweep may run before it gives up.
 *
 * A whole band window at this stage, `fluxHold(10) + FLUX_SHIMMER` = 1.55 s, plus
 * 20%: a build that never shimmers is reported as a hold longer than the window
 * rather than hanging. It also clears the unscaled hold of 1.6 s, so a build that
 * simply never scales is measured and named rather than timing out.
 */
const SWEEP_FRAMES = framesFor(Math.max(HOLD + FLUX_SHIMMER, 1.6) * 1.2);

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("holds a stage-ten Flux's band for fluxHold(10) before the shimmer", async () => {
  // An empty, quiet, live wave, posed at the stage whose hold is under test, then
  // exactly the one drone the requirement is about.
  await startPosed(harness, { stage: STAGE });
  assertCloseTo(
    (await harness.snapshot()).fluxHold,
    HOLD,
    SCALE_DIGITS,
    `the Flux hold the game derives at stage ${STAGE}, ` +
      "max(1.0, FLUX_HOLD_L1 - 0.05 * (stage - 1)) (specs/stages.md)",
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
    "the seconds a Flux holds its band before shimmering at stage " +
      `${STAGE}, fluxHold(${STAGE}) = ${HOLD} s ` +
      "(specs/stages.md, specs/drones.md)",
  );
  assertEqual(
    requireDrone(shimmered.snapshot, flux).band,
    POSED_BAND,
    "the band the Flux held for the whole window it entered on " +
      "(specs/drones.md)",
  );

  // The boundary itself, posed either side of the stated hold and read back. No
  // frame is driven between the pose and the reading: `shimmer` is derived at the
  // call from the clock this sets.
  await harness.debug.setDroneBandClock(flux, HOLD - PROBE_EPSILON);
  assertEqual(
    requireDrone(await harness.snapshot(), flux).shimmer,
    false,
    `a stage-${STAGE} Flux still holding its band with its band clock ` +
      `at ${HOLD - PROBE_EPSILON} s, under fluxHold(${STAGE}) ` +
      `= ${HOLD} s (specs/stages.md, specs/instrumentation.md)`,
  );
  await harness.debug.setDroneBandClock(flux, HOLD);
  assertTrue(
    requireDrone(await harness.snapshot(), flux).shimmer,
    `a stage-${STAGE} Flux shimmering with its band clock at ` +
      `fluxHold(${STAGE}) = ${HOLD} s itself, which ` +
      "specs/instrumentation.md makes the first instant of the shimmer",
  );
});
