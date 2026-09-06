// instrumentation/frame-division-independent — an interval of game time is one interval.
//
// `specs/instrumentation.md`: "every rate is integrated against the delta time
// the game is given, so an interval of game time reaches the same state however
// it was divided into frames."
//
// It is the property every timed figure in this specification rests on. A build
// that spends a rate PER FRAME rather than per second runs sixty times faster on
// a fast display than on a slow one: the fuel drains in seconds, the drill breaks
// rock at whatever the monitor's refresh happens to be, and the Core Sample's
// ninety seconds are not ninety seconds. That is what this reads, by running the
// same posed second at two step sizes a factor of sixty apart — one frame of a
// whole second against sixty frames of a sixtieth.
//
// WHAT IS COMPARED, AND WHY EACH READING IS THE FAIR ONE.
//
//  - `simTime` and the FUEL burnt. Both are pure integrations of the elapsed time
//    — `specs/character.md` puts life support at `LIFE_SUPPORT_BURN` fuel per
//    second below the ground line — so they carry no discretization error at all
//    and are read exactly. This is the reading a per-frame rate fails outright.
//  - The VELOCITY of a fall. `specs/character.md` accelerates the miner at
//    `GRAVITY` per second, and a velocity integrated at any step size reaches the
//    same figure at the end of the interval. The fall is posed RISING at `600`
//    units per second so that a second of gravity leaves it at `900`, below the
//    `950` an empty fall caps at: a comparison taken at the cap would agree for
//    the wrong reason, because both step sizes would be clamped to the same
//    number whatever they had done to get there.
//  - The POSITION of a fall already at terminal speed. There the velocity is
//    constant, so the distance covered is exact at any step size and the two runs
//    have to land on the same place. Its counterpart — the position of the
//    ACCELERATING fall — is the one reading that genuinely drifts with the step
//    size, by up to `GRAVITY * t * dt / 2` for each of the two runs, so it is held
//    to exactly that bound and no tighter.
//
// The mine is empty for the whole of both falls, the drill is gated, and no key
// is held, so the only thing acting is the integration under test.

import { afterEach, beforeEach, it } from "vitest";
import { FALL_TERMINAL_EMPTY, GRAVITY, LIFE_SUPPORT_BURN } from "../constants";
import { assertBetween, assertCloseTo } from "../assert";
import {
  captureReplay,
  createHarness,
  minerXOn,
  minerYOn,
  openScene,
  pinDrill,
  placeAt,
  type Harness,
} from "../harness";

const COL = 6;
/** A row deep enough that both falls stay in open mine, and below the ground line. */
const ROW = 100;

/** The interval, and the two divisions of it. */
const SECONDS = 1;
const COARSE_FRAMES = 1;
const FINE_FRAMES = 60;

/** The rising speed the accelerating fall is posed at, in units per second. */
const RISING = 600;

/** What one run of the interval reached. */
interface Run {
  y: number;
  vy: number;
  simTime: number;
  fuel: number;
}

let h: Harness;

/** Pose the fall at `vy` and run the interval in `frames` whole frames. */
async function run(vy: number, frames: number): Promise<Run> {
  placeAt(h, minerXOn(COL), minerYOn(ROW));
  h.debug.setMinerVelocity(0, vy);
  h.debug.setFuel(100);
  const before = h.snapshot();
  await h.advanceSeconds(SECONDS, frames);
  const after = h.snapshot();
  return {
    y: after.miner.y,
    vy: after.miner.vy,
    simTime: after.simTime - before.simTime,
    fuel: before.miner.fuel - after.miner.fuel,
  };
}

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reaches the same second of game time in one frame and in sixty", async () => {
  openScene(h);
  pinDrill(h);

  const coarse = await run(-RISING, COARSE_FRAMES);
  const fine = await captureReplay(h, "drive", () => run(-RISING, FINE_FRAMES));

  // The interval itself, and everything integrated purely against it.
  assertCloseTo(coarse.simTime, SECONDS, 6, "the game time one frame covered");
  assertCloseTo(fine.simTime, SECONDS, 6, "the game time sixty frames covered");
  assertCloseTo(
    coarse.fuel,
    LIFE_SUPPORT_BURN * SECONDS,
    6,
    "the life support burnt over one frame",
  );
  assertCloseTo(
    fine.fuel,
    LIFE_SUPPORT_BURN * SECONDS,
    6,
    "the life support burnt over sixty frames",
  );

  // The velocity the acceleration reached, which the step size does not change.
  const reached = -RISING + GRAVITY * SECONDS;
  assertCloseTo(
    coarse.vy,
    reached,
    3,
    "the speed one frame of gravity reached",
  );
  assertCloseTo(
    fine.vy,
    reached,
    3,
    "the speed sixty frames of gravity reached",
  );

  // The position, held to the drift a change in step size explains and no wider:
  // half of `GRAVITY * t * dt` for each of the two divisions.
  const drift =
    (GRAVITY * SECONDS * (SECONDS / COARSE_FRAMES + SECONDS / FINE_FRAMES)) / 2;
  assertBetween(
    fine.y - coarse.y,
    -drift,
    drift,
    "the distance the two divisions disagree by",
  );

  // And a fall already at terminal speed, where the velocity is constant and the
  // distance carries no step-size error at all, lands in the same place.
  const coarseFlat = await run(FALL_TERMINAL_EMPTY, COARSE_FRAMES);
  const fineFlat = await run(FALL_TERMINAL_EMPTY, FINE_FRAMES);
  assertCloseTo(
    fineFlat.y,
    coarseFlat.y,
    1,
    "where a second at terminal speed leaves the miner",
  );
  assertCloseTo(
    fineFlat.vy,
    coarseFlat.vy,
    3,
    "the speed a second at terminal speed leaves the miner at",
  );
});
