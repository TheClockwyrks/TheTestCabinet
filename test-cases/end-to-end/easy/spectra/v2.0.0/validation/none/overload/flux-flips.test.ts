// overload/flux-flips — an overloaded Flux flips its band and restarts its window.
//
// specs/mode.md gives the Flux's reaction, and this point reads the first half of
// it: "Its stored band flips to the opposite one and its band clock returns to `0`,
// ending the window it was in ... It then runs its rhythm on from the fresh
// window."
//
// TWO FIELDS, ONE RULE. specs/drones.md keeps the stored band and the band clock
// as two independent fields with one writer each, so an overload that moved only
// the band would leave the Flux part-way through a window it is no longer in — and
// the moment that window ran out, the build's own oscillation would flip the band
// straight back and undo the reaction. That is why the specification states the
// clock beside the flip, and why both are read here.
//
// THE POSE MAKES EVERY WRONG MODEL A DIFFERENT NUMBER. The Flux is posed holding
// cyan at a distinctive point inside its window — far enough in that a clock left
// alone is unmistakable, and short of `fluxHold(stage)` so the drone is holding a
// band rather than shimmering, since a shimmering Flux takes no charge at all
// (specs/mode.md, and `overload/shimmer-takes-no-charge`). So a build that flips
// nothing reads cyan; one that flips the band but leaves the clock reads magenta at
// the posed clock; one that clears the clock but not the band reads cyan at 0; and
// a conforming build reads magenta at 0.
//
// THE OSCILLATION IS OFF, so the only thing that can write either field over the
// scenario is the overload. specs/instrumentation.md's gate stops the clock
// advancing and nothing else, and neither field is posed after the shot.
//
// WHAT THIS DOES NOT DECIDE. The spray that goes with the flip, which is
// `overload/flux-sprays-count` and `overload/flux-spray-angle`; and the rhythm
// itself, which is `drones/flux-cycle-holds` and `drones/flux-emerges-opposite`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLessThanOrEqual } from "../assert";
import { FORM_CENTER_X, OVERLOAD_AT, fluxHold } from "../constants";
import {
  captureStill,
  createHarness,
  poseDrone,
  requireDrone,
  seconds,
  startPosed,
  type Harness,
} from "../harness";
import { mismatchShot } from "./charge";

/** The stage the scenario is posed at, which fixes `fluxHold`. */
const STAGE = 1;

/** Where the target Flux stands. As in `overload/mismatch-charges`. */
const TARGET = { x: FORM_CENTER_X, y: 300 } as const;

/**
 * Where in its band window the Flux is posed, in seconds.
 *
 * Half of `fluxHold(STAGE)` (1.6 s at stage 1): squarely inside the held part, so
 * the drone reads as the band it stores and a mismatched shot really is one, and
 * far enough from `0` that a clock the overload never touched cannot be mistaken
 * for one it returned to `0`.
 */
const POSED_CLOCK = fluxHold(STAGE) / 2;

/**
 * The most the band clock may read afterwards, in seconds.
 *
 * `specs/mode.md` says the clock returns to `0`, so this is not a margin around a
 * figure but a bound on what a build may have added back on the frame the overload
 * landed: one frame of the harness's 100 Hz clock. The Flux's oscillation is off,
 * which by specs/instrumentation.md leaves the clock where it stands, so a
 * conforming build reads exactly `0`.
 */
const CLOCK_TOLERANCE = seconds(1);

/**
 * How far below the target the shot is placed, in logical units.
 *
 * Nearly seven times the 21-unit contact reach a Flux has against one of the
 * player's bullets (`FLUX_HALF` 15 + `PLAYER_BULLET_HALF` 6).
 */
const SHOT_BELOW = 140;

/**
 * Frames the flight is allowed.
 *
 * At `PLAYER_BULLET_SPEED` (760), 7.6 units per frame of the harness's 100 Hz
 * clock: the bullet enters the contact reach inside 16 frames, and thirty leaves
 * slack for whichever frame a build resolves the contact on.
 */
const SHOT_FRAMES = 30;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("puts an overloaded Flux on the opposite band with its window restarted", async () => {
  await startPosed(harness, { stage: STAGE });
  const target = await poseDrone(harness, "flux", TARGET.x, TARGET.y, {
    band: "cyan",
    bandClock: POSED_CLOCK,
    charge: OVERLOAD_AT - 1,
  });

  const posed = requireDrone(
    await harness.snapshot(),
    target,
    "the posed Flux",
  );
  assertEqual(
    posed.shimmer,
    false,
    `a Flux posed ${String(POSED_CLOCK)} s into its window, inside the ` +
      `${String(fluxHold(STAGE))} s hold stage ${String(STAGE)} gives it, ` +
      "holding a band rather than shimmering (specs/drones.md)",
  );

  const shot = await mismatchShot(harness, target, {
    below: SHOT_BELOW,
    maxFrames: SHOT_FRAMES,
  });
  await captureStill(harness, "flipped");

  assertEqual(
    shot.hit,
    true,
    `the ${shot.band} shot resolving inside the ${String(SHOT_FRAMES)} frames ` +
      "its climb takes",
  );
  const flipped = requireDrone(
    shot.snapshot,
    target,
    "the Flux the overload leaves standing",
  );
  assertEqual(
    flipped.band,
    "magenta",
    "the stored band an overloaded Flux reports in the frame it overloads, which " +
      "is the opposite of the cyan it was posed holding (specs/mode.md)",
  );
  assertLessThanOrEqual(
    flipped.bandClock,
    CLOCK_TOLERANCE,
    `the band clock an overloaded Flux reports, returned to 0 from the ` +
      `${String(POSED_CLOCK)} s it was posed at, so the window it was in is over ` +
      "(specs/mode.md)",
  );
});
