// drones/flux-fires-held-band — a diving Flux's bullet carries the band it holds.
//
// specs/drones.md, What that means in play: "A Flux takes exactly one shot over a
// dive, carrying the band it stores at the moment of the shot."
// specs/swarm.md says the same from the bullet's side: "An enemy bullet carries
// the band its firer stores at the shot, fixed for the bullet's life." That is
// what makes a Flux's dive a question for the player rather than a formality: the
// band the ship must be tuned to in order to absorb the shot is the band the drone
// happened to be holding when it fired.
//
// WHAT IS DRIVEN. One Flux alone, sixty units above `DIVE_FIRE_Y` (360), diving
// with travel and fire on, holding MAGENTA half-way through the held part of its
// window with its OSCILLATION GATE OFF. The gate is what makes the reading
// unambiguous: with the clock frozen, the band the drone stores at the shot is the
// band this check posed, whichever frame the build takes the shot on. A live clock
// would have made the expected answer depend on the timing of the crossing, which
// is `swarm`'s requirement rather than this one's.
//
// MAGENTA IS THE DISTINGUISHING VALUE. `addDrone` creates a drone holding cyan
// (specs/instrumentation.md), so a build that stamps its bullets with a default,
// with the ship's band, or with the band of the drone it created rather than the
// one it stores now, reads cyan here and fails.
//
// The COUNT of shots a Flux takes is not read here: this check asserts the band of
// the bullet the dive produced, and stops there.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertGreaterThanOrEqual } from "../assert";
import { DIVE_FIRE_Y, FORM_CENTER_X, fluxHold } from "../constants";
import {
  captureStill,
  createHarness,
  framesFor,
  poseDrone,
  startPosed,
  type Harness,
} from "../harness";
import { watchDive } from "./dive";

/** The stage the scenario is posed at: the held part's length is per stage. */
const STAGE = 1;

/** The band the Flux holds at the shot. */
const POSED_BAND = "magenta" as const;

/**
 * The band clock the diving Flux is posed at: half-way through the held part.
 *
 * Inside the hold — the window in which a Flux fires at all — under any reading of
 * either end, and, with the oscillation gate off, where it stays for the dive.
 */
const MID_HOLD = fluxHold(STAGE) / 2;

/**
 * Where the diving Flux starts.
 *
 * Sixty units above `DIVE_FIRE_Y` (360) on the ship's lane, so the crossing that
 * buys the shot happens early in the dive whatever path the build lays out.
 */
const AT = { x: FORM_CENTER_X, y: DIVE_FIRE_Y - 60 } as const;

/**
 * Frames the dive is watched for.
 *
 * specs/swarm.md: "A dive runs no longer than eight seconds." The sweep stops the
 * moment the drone leaves phase `diving`, which is sooner on any build whose
 * dives end.
 */
const DIVE_FRAMES = framesFor(8);

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("gives a diving Flux's bullet the band the Flux holds", async () => {
  await startPosed(harness, { stage: STAGE });
  const flux = await poseDrone(harness, "flux", AT.x, AT.y, {
    band: POSED_BAND,
    bandClock: MID_HOLD,
    // Off, so the band the drone stores at the shot is the band posed here
    // whichever frame the build takes the shot on.
    oscillation: false,
    phase: "diving",
    travel: true,
    fire: true,
  });

  const dive = await watchDive(harness, flux, { maxFrames: DIVE_FRAMES });
  await captureStill(harness, "band");

  assertGreaterThanOrEqual(
    dive.shots.length,
    1,
    "a bullet from the diving Flux's crossing of DIVE_FIRE_Y (specs/swarm.md)",
  );
  assertEqual(
    dive.shots[0]?.band,
    POSED_BAND,
    "the band a diving Flux's bullet carries, the one the Flux stores (specs/drones.md)",
  );
});
