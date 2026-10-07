// drones/flux-shimmer-duration — the shimmer lasts exactly its telegraph.
//
// specs/drones.md: a band window is `fluxWindow(stage) = fluxHold(stage) +
// FLUX_SHIMMER`, with `FLUX_SHIMMER` (`0.4`) seconds, and the Flux shimmers for
// the part of the window at or above `fluxHold(stage)`. The shimmer is the
// telegraph — the window in which no shot destroys the drone
// (`drones/flux-shimmer-immune`) — so its LENGTH is what a player reads to know
// when to hold fire, and it is fixed rather than scaled: `specs/stages.md` scales
// the hold and leaves `FLUX_SHIMMER` alone.
//
// WHAT IS MEASURED, AND FROM WHERE. The shimmer is measured between the build's
// OWN two transitions rather than from a posed clock value. The Flux is posed at
// the start of a window with its oscillation gate on, the sweep runs to the frame
// `shimmer` first turns true, and the measured span runs from there to the frame
// it turns false again. Posing the band clock at `fluxHold(stage)` exactly would
// have measured from a boundary instead, and would have read a build that takes
// "at or above" as "above" as having no shimmer at all — a quibble about one
// frame, not about the telegraph this point is named for.
//
// The still is taken mid-shimmer, half a telegraph in, so the reviewer sees the
// drone in the state the measurement is about rather than the frame it left it.
//
// Where the window BEGINS is `drones/flux-cycle-holds`, and which band it ends on
// is `drones/flux-emerges-opposite`.

import { afterEach, beforeEach, it } from "vitest";
import { assertBetween } from "../assert";
import { FLUX_SHIMMER, FORM_CENTER_X, fluxWindow } from "../constants";
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

/** The stage the scenario is posed at: the hold before the shimmer is per stage. */
const STAGE = 1;

/** Where the Flux stands. Mid-field, clear of both HUD strips and of the ship. */
const AT = { x: FORM_CENTER_X, y: 300 } as const;

/**
 * How far the measured shimmer may sit from `FLUX_SHIMMER`, as a fraction.
 *
 * The manifest's figure. 10% of 0.4 s is 0.04 s, four frames of the harness's
 * clock: enough for how a build divides a frame into sub-steps
 * (specs/simulation.md) and nowhere near enough to pass a build running a
 * different telegraph.
 */
const TOLERANCE = 0.1;

/** One frame of the 100 Hz clock: the sweep's own reading quantum, per end. */
const SAMPLE = seconds(1);

/**
 * Frames from the start of the window to the shimmer, before the sweep gives up.
 *
 * A whole window plus 20%. A build that never shimmers spends this and then reads
 * as a shimmer of the half-telegraph below, which fails — a verdict rather than
 * a hang.
 */
const ENTER_FRAMES = framesFor(fluxWindow(STAGE) * 1.2);

/** Frames into the shimmer the still is taken at: half the telegraph. */
const MID_FRAMES = framesFor(FLUX_SHIMMER / 2);

/**
 * Frames the shimmer's end is swept for, after the still.
 *
 * Twice the telegraph, so a shimmer that runs long is measured as long rather
 * than clipped at the bound this check asserts.
 */
const LEAVE_FRAMES = framesFor(FLUX_SHIMMER * 2);

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("shimmers for FLUX_SHIMMER seconds", async () => {
  await startPosed(harness, { stage: STAGE });
  const flux = await poseDrone(harness, "flux", AT.x, AT.y, {
    bandClock: 0,
    oscillation: true,
  });

  await harness.until((snapshot) => requireDrone(snapshot, flux).shimmer, {
    maxFrames: ENTER_FRAMES,
    poll: 1,
  });
  await harness.advance(MID_FRAMES);
  await captureStill(harness, "shimmer");
  const settled = await harness.until(
    (snapshot) => !requireDrone(snapshot, flux).shimmer,
    { maxFrames: LEAVE_FRAMES, poll: 1 },
  );

  assertBetween(
    seconds(MID_FRAMES + settled.frames),
    FLUX_SHIMMER * (1 - TOLERANCE) - SAMPLE,
    FLUX_SHIMMER * (1 + TOLERANCE) + SAMPLE,
    "the seconds a Flux shimmers, FLUX_SHIMMER (specs/drones.md)",
  );
});
