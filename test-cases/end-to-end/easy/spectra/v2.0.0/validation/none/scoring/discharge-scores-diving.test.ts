// Spectra — scoring/discharge-scores-diving: a discharge kill pays the diving
// figure.
//
// THE RULE. `specs/scoring.md`, under the drone table: "A drone destroyed by a
// discharge wave pays the same as one destroyed by a bullet in that phase."
// `specs/resonance.md` says the wave destroys "A drone in phase `entering`,
// `diving`, or `returning`" and leaves a drone in phase `formation` alone — so
// every drone a wave can reach is in one of the three phases the table pays the
// DIVING figure for. This point decides that the wave pays those figures rather
// than a figure of its own.
//
// TWO KINDS, IN ONE WAVE, BECAUSE THE RULE SAYS "EACH". A Shard and a Flux, both
// diving, pay `SCORE_SHARD_DIVE` (`100`) and `SCORE_FLUX_DIVE` (`160`), so the
// score after one wave must read their sum, `260`. That single number tells the
// wrong models apart: a build that pays the FORMATION figures reads `130`
// (`50` + `80`); one that pays a flat figure per drone reads twice that figure —
// `200` for the Shard's, `320` for the Flux's; one that pays only the first drone
// it reaches reads `100` or `160`; and one that pays a discharge nothing reads
// `0`. A failure therefore names which model the build implemented.
//
// THE WAVE IS THE REAL ONE. `specs/instrumentation.md` gives the surface no
// operation that discharges — "A caller checking the discharge poses the meter
// and drives the discharge action" — so the meter is posed at `RESONANCE_MAX`
// and `KeyX`, the key `specs/controls.md` binds, is pressed through Chromium's
// own input pipeline. What the wave then takes is the build's own.
//
// THE TWO DRONES ARE PROPS AND NOTHING ELSE. `poseDrone` leaves every faculty
// off, so each holds its exact centre and its phase (`specs/instrumentation.md`)
// while the wave grows past it, and neither fires. Both stand about 200 units
// from the ship, which the wave passes early in its `DISCHARGE_TIME` (`0.5`)
// seconds, and the drive runs the whole of that span so the reading is taken
// after the wave has finished rather than mid-growth. The Flux's band clock is
// posed at `0` with its oscillation off, so it is not shimmering — the wave is
// band-blind (`specs/resonance.md`) and would take it either way, but a drone
// that is not changing under the reading is one less thing in the scenario.
//
// WHAT THIS DOES NOT DECIDE. That `KeyX` releases the wave is
// `controls/discharge-x`; what the wave destroys and spares is `resonance`'s;
// the two figures themselves are `scoring/shard-diving` and
// `scoring/flux-diving`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertLength, assertUndefined } from "../assert";
import {
  DISCHARGE_TIME,
  RESONANCE_MAX,
  SCORE_FLUX_DIVE,
  SCORE_SHARD_DIVE,
} from "../constants";
import {
  captureStill,
  createHarness,
  droneById,
  framesFor,
  poseDrone,
  startPosed,
  type Harness,
} from "../harness";

/** The one key `specs/controls.md` binds the `discharge` action to. */
const DISCHARGE_KEY = "KeyX";

/**
 * Where the two drones stand: a clear stretch of the play field, below the
 * formation grid's lowest row (`332`) and its full sway, above the ship's lane
 * (`SHIP_Y`, `600`), either side of the lane's centre. Each is about `200` units
 * from the ship, which the
 * wave's radius passes in the first tenth of its life.
 */
const SHARD_AT = { x: 500, y: 460 } as const;
const FLUX_AT = { x: 780, y: 460 } as const;

/**
 * How far into its band window the Flux stands: `0`, the start of a window and
 * squarely in the held part, with its oscillation gate off so it stays there.
 */
const HELD_CLOCK = 0;

/**
 * Frames the wave is given to finish, at the harness's 100 Hz.
 *
 * `DISCHARGE_TIME` (`0.5`) seconds is the whole life of a wave
 * (`specs/resonance.md`), and two frames beyond it so the reading is taken after
 * the wave has stopped rather than while its radius is still growing. It is a
 * span rather than a tolerance: nothing about the outcome depends on where in it
 * the two drones fall.
 */
const WAVE_FRAMES = framesFor(DISCHARGE_TIME) + 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("pays each drone the wave destroys its diving figure", async () => {
  await startPosed(h);
  const shard = await poseDrone(h, "shard", SHARD_AT.x, SHARD_AT.y, {
    band: "cyan",
    phase: "diving",
  });
  const flux = await poseDrone(h, "flux", FLUX_AT.x, FLUX_AT.y, {
    band: "magenta",
    phase: "diving",
    bandClock: HELD_CLOCK,
  });
  await h.debug.setResonance(RESONANCE_MAX);

  const before = await h.snapshot();
  assertEqual(before.score, 0, "precondition: the run opens with a score of 0");
  assertLength(
    before.drones,
    2,
    "precondition: the field holds the two divers",
  );

  await h.tap(DISCHARGE_KEY);
  await h.advance(WAVE_FRAMES);

  // The score the wave's kills paid, once the wave has run its course.
  await captureStill(h, "paid");

  const after = await h.snapshot();
  assertUndefined(
    droneById(after, shard),
    "precondition: the wave destroyed the diving Shard (specs/resonance.md)",
  );
  assertUndefined(
    droneById(after, flux),
    "precondition: the wave destroyed the diving Flux (specs/resonance.md)",
  );
  assertEqual(
    after.score,
    SCORE_SHARD_DIVE + SCORE_FLUX_DIVE,
    `the score after one discharge wave destroyed a diving Shard and a diving ` +
      `Flux (specs/scoring.md: a drone destroyed by a discharge wave pays the ` +
      `same as one destroyed by a bullet in that phase, so ` +
      `SCORE_SHARD_DIVE ${SCORE_SHARD_DIVE} + SCORE_FLUX_DIVE ` +
      `${SCORE_FLUX_DIVE})`,
  );
});
