// bands/inversion-changes-outcome — an inversion changes what a shot destroys.
//
// specs/bands.md decides a shot by "the two effective bands ... and nothing else
// does", and an active inversion is one of the toggles that produce a drone's
// effective band while never touching a player bullet's. Put together: with an
// inversion running, a stored-MAGENTA Shard reads cyan, so it is the CYAN shot
// that destroys it and the magenta one that does not — the exact reverse of the
// outcome the same two shots have with no inversion
// (`bands.match-destroys`, `bands.mismatch-spares`).
//
// BOTH HALVES ARE READ IN ONE SCENARIO, because the point is the REVERSAL and
// each half alone is already graded elsewhere. Two Shards of the same stored band
// stand under one inversion and take one shot each; the pair is what makes every
// wrong model read differently. A build that ignores the inversion in its match
// spares the first and destroys the second, one that inverts the player's bullets
// too spares both, and one that inverts nothing at all spares the first alone.
//
// THE TWO TARGETS STAND WELL APART, {@link SEPARATION} units, which is many times
// the reach of any contact the case defines — the widest is a Prism's `28` plus a
// bullet's `6` — so neither shot can resolve against the other's target and each
// verdict belongs to its own drone.
//
// THE SECOND TARGET SURVIVES THE FIRST KILL. specs/stages.md clears a stage in
// the moment its LAST drone is destroyed, so a scenario holding one drone would
// leave the wave behind the instant the matching shot landed. Holding both here
// is not a bystander parked in a corner: each is a target this point fires at.

import { afterEach, beforeEach, it } from "vitest";
import { INVERSION_TIME, PRISM_HALF, SHARD_HALF } from "../../src/constants";
import { assertNotNull, assertNull } from "../assert";
import {
  captureStill,
  createHarness,
  fireAt,
  findDrone,
  poseDrone,
  startPosed,
  type Harness,
} from "../harness";

/** Where the two targets stand, and how far apart (specs/field.md). */
const MATCHED_X = 480;
const SPARED_X = 800;
const TARGET_Y = 320;
const SEPARATION = SPARED_X - MATCHED_X;

/** The band both Shards store, and what an inversion makes them read as. */
const STORED_BAND = "magenta" as const;
const SWAPPED_BAND = "cyan" as const;

/** The band the shot that must destroy carries, and the one that must not. */
const MATCHING_SHOT = SWAPPED_BAND;
const MISMATCHED_SHOT = STORED_BAND;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("destroys a stored-magenta Shard with a cyan shot and spares it from a magenta one", async () => {
  startPosed(h);
  h.debug.setInversion(INVERSION_TIME);
  const matchedId = poseDrone(h, "shard", MATCHED_X, TARGET_Y, {
    band: STORED_BAND,
  });
  const sparedId = poseDrone(h, "shard", SPARED_X, TARGET_Y, {
    band: STORED_BAND,
  });

  await fireAt(h, MATCHED_X, TARGET_Y, MATCHING_SHOT);
  await fireAt(h, SPARED_X, TARGET_Y, MISMATCHED_SHOT);
  captureStill(h, "outcome");

  const field = h.snapshot();
  assertNull(
    findDrone(field, matchedId),
    `the Shard storing ${STORED_BAND} at x ${MATCHED_X} is gone from the ` +
      `roster after a ${MATCHING_SHOT} shot, with an inversion of ` +
      `${INVERSION_TIME} s posed — specs/bands.md: an inversion makes it read ` +
      `${SWAPPED_BAND}, and a bullet whose effective band equals the drone's ` +
      "destroys it",
  );
  assertNotNull(
    findDrone(field, sparedId),
    `the Shard storing ${STORED_BAND} at x ${SPARED_X}, ${SEPARATION} units ` +
      `clear of the first and far beyond the widest contact reach the case ` +
      `defines (${PRISM_HALF} plus a bullet's, against this Shard's ` +
      `${SHARD_HALF}), is still on the field after a ${MISMATCHED_SHOT} shot ` +
      `— specs/bands.md: under an inversion it reads ${SWAPPED_BAND}, and a ` +
      "player bullet is never swapped, so the two bands are opposite",
  );
});
