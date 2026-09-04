// drones/flux-held-killable — a Flux falls to a matching shot inside its hold.
//
// specs/drones.md, What that means in play: "A shot whose effective band matches
// the Flux during a held part of the window destroys it." This is the half of the
// rhythm that makes the kind beatable at all: the shimmer is the window in which
// nothing works (`drones/flux-shimmer-immune`), and the hold is the window in
// which the matching shot does. A build that spared a Flux in both windows would
// pass the immunity point and fail here, which is the pair working as intended.
//
// HOW THE HOLD IS HELD OPEN. The Flux is posed half-way through the held part of
// its window with its OSCILLATION GATE OFF, which specs/instrumentation.md
// defines as holding "whichever band or shimmer it is in indefinitely". The shot
// is therefore decided against a drone that is unambiguously holding its band for
// the whole flight, rather than one whose clock might reach the shimmer while the
// bullet is still climbing. Travel and fire stay off: this drone is a target and
// nothing else.
//
// The posed band is magenta — not `addDrone`'s default cyan
// (specs/instrumentation.md) — and the shot carries magenta too, so a build that
// matches against a default rather than against the drone's stored band spares
// the Flux and fails.
//
// One bystander stands out of the way, because this scenario destroys the drone
// it poses and specs/stages.md clears a stage in the moment the last drone of its
// wave is destroyed; the bystander leaves the wave a drone under either reading of
// "its wave", so the field is still live when the reading is taken.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertUndefined } from "../assert";
import { FORM_CENTER_X, fluxHold } from "../constants";
import {
  captureStill,
  createHarness,
  droneById,
  poseBystander,
  poseDrone,
  shootDrone,
  startPosed,
  type Harness,
} from "../harness";

/** The stage the scenario is posed at: the held part's length is per stage. */
const STAGE = 1;

/** The band the Flux holds, and the band the shot carries. */
const POSED_BAND = "magenta" as const;

/**
 * The band clock the Flux is posed at: half-way through the held part.
 *
 * The hold runs from `0` up to `fluxHold(1)` (specs/drones.md), so its midpoint is
 * inside it under any reading of either end, and it is far enough from the shimmer
 * that the whole flight below lands inside the hold on a build whose clock is
 * frozen and on one whose gate leaks.
 */
const MID_HOLD = fluxHold(STAGE) / 2;

/** Where the Flux stands. Mid-field, clear of both HUD strips and of the ship. */
const AT = { x: FORM_CENTER_X, y: 300 } as const;

/**
 * How far below the Flux the shot is placed, in logical units.
 *
 * A Flux's contact reach against one of the player's bullets is `FLUX_HALF` (15)
 * plus `PLAYER_BULLET_HALF` (6) = 21 units of centre separation, so 140 starts the
 * bullet nearly seven times clear of it.
 */
const SHOT_BELOW = 140;

/**
 * Frames the flight is allowed.
 *
 * At `PLAYER_BULLET_SPEED` (760), 7.6 units per frame of the harness's 100 Hz
 * clock: the bullet enters the 21-unit reach inside 16 frames, and thirty leaves
 * fourteen for whichever frame a build resolves the contact on.
 */
const SHOT_FRAMES = 30;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("destroys a Flux hit by its own band during a held window", async () => {
  await startPosed(harness, { stage: STAGE });
  await poseBystander(harness);
  const flux = await poseDrone(harness, "flux", AT.x, AT.y, {
    band: POSED_BAND,
    bandClock: MID_HOLD,
    // Off: the hold stands still for the whole flight, so the shot is decided
    // against a Flux that is holding rather than one that reached its shimmer.
    oscillation: false,
  });

  const shot = await shootDrone(harness, flux, POSED_BAND, {
    below: SHOT_BELOW,
    maxFrames: SHOT_FRAMES,
  });
  await captureStill(harness, "killed");

  assertEqual(shot.hit, true, "the matching shot resolving inside its flight");
  assertUndefined(
    droneById(shot.snapshot, flux),
    `the holding Flux a ${POSED_BAND} shot destroys (specs/drones.md)`,
  );
});
