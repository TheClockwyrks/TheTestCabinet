// drones/flux-cycle-holds — a Flux holds its band for the whole held part.
//
// specs/drones.md, Its rhythm: the band clock "advances with game time" from `0`
// to `fluxWindow(stage)`, and the window runs in two parts — "Below
// `fluxHold(stage)` | Holding its stored band" and "At or above `fluxHold(stage)`
// | Shimmering, settled on neither band". So a Flux posed at the START of a window
// holds its band for `fluxHold(stage)` seconds and only then shimmers. That length
// is the whole threat model of the kind: it is how long a player has to line up
// the matching shot, and specs/stages.md scales it stage by stage.
//
// WHAT IS DRIVEN. One Flux alone, its band clock at `0`, with the OSCILLATION gate
// on and travel and fire off — the isolation specs/instrumentation.md was designed
// for: "A check on a Flux's rhythm poses it with travel off and oscillation on, so
// the band clock is the only thing moving." Nothing about the shimmer is posed; the
// sweep watches for the build's own `shimmer` to turn true and reads the game time
// that took.
//
// WHY THE TRANSITION IS WATCHED FOR RATHER THAN THE CLOCK READ BACK. `shimmer` is
// derived from the band clock, so reading the clock would grade the arithmetic of
// a field this check already set. Sweeping to the transition grades the thing the
// player experiences: how long the drone is killable.
//
// The other two thirds of the window are their own points:
// `drones/flux-shimmer-duration` measures the shimmer, and
// `drones/flux-emerges-opposite` the band it comes out on.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween, assertEqual } from "../assert";
import { FORM_CENTER_X, fluxHold, fluxWindow } from "../constants";
import {
  captureReplay,
  createHarness,
  framesFor,
  poseDrone,
  requireDrone,
  seconds,
  startPosed,
  type Harness,
} from "../harness";

/** The stage the scenario is posed at: the hold is stated per stage. */
const STAGE = 1;

/** The hold specs/stages.md states at this stage: `fluxHold(1)` = 1.6 s. */
const HOLD = fluxHold(STAGE);

/** The band the Flux is posed holding, which is not `addDrone`'s default cyan. */
const POSED_BAND = "magenta" as const;

/** Where the Flux stands. Mid-field, clear of both HUD strips and of the ship. */
const AT = { x: FORM_CENTER_X, y: 300 } as const;

/**
 * How far the measured hold may sit from `fluxHold(1)`, as a fraction.
 *
 * The manifest's own figure, and an honest one: specs/drones.md fixes the hold
 * exactly, and the tolerance covers only how a build divides a frame into
 * sub-steps (`SUBSTEP_MAX`, specs/simulation.md) and where inside a frame it
 * decides the window turned over. 10% of 1.6 s is 0.16 s — a sixth of the hold —
 * so a build running the Flux at a different rhythm entirely still fails.
 */
const TOLERANCE = 0.1;

/**
 * One frame of the harness's 100 Hz clock, added to each end of the bound.
 *
 * The sweep reads `shimmer` once per frame, so the instant it reports is the
 * frame boundary at or after the true transition. That quantum is the harness's,
 * not the build's, so it is allowed on top of the specification's tolerance
 * rather than out of it.
 */
const SAMPLE = seconds(1);

/**
 * Frames the sweep may run before it gives up.
 *
 * A whole band window, `fluxWindow(1)` = 2.0 s, plus 20%: a build that never
 * shimmers is reported as a hold longer than the window rather than hanging, and
 * the cap is far outside the bound above, so it decides nothing a passing build
 * could hit.
 */
const SWEEP_FRAMES = framesFor(fluxWindow(STAGE) * 1.2);

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("holds a Flux's band for fluxHold(stage) before the shimmer", async () => {
  await startPosed(harness, { stage: STAGE });
  const flux = await poseDrone(harness, "flux", AT.x, AT.y, {
    band: POSED_BAND,
    bandClock: 0,
    oscillation: true,
  });

  const shimmered = await captureReplay(harness, "hold", () =>
    harness.until((snapshot) => requireDrone(snapshot, flux).shimmer, {
      maxFrames: SWEEP_FRAMES,
      poll: 1,
    }),
  );

  assertBetween(
    seconds(shimmered.frames),
    HOLD * (1 - TOLERANCE) - SAMPLE,
    HOLD * (1 + TOLERANCE) + SAMPLE,
    "the seconds a Flux holds its band before shimmering, fluxHold(1) (specs/drones.md)",
  );
  assertEqual(
    requireDrone(shimmered.snapshot, flux).band,
    POSED_BAND,
    "the band the Flux held for the whole window it entered on (specs/drones.md)",
  );
});
