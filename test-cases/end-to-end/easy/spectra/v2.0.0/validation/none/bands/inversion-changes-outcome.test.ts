// bands/inversion-changes-outcome — an inversion changes what a shot destroys.
//
// The two sibling items read the inversion off the SNAPSHOT: what a drone reports
// as its effective band. This one reads it off the GAME. specs/bands.md decides a
// contact by the two effective bands "and nothing else does", so an inversion
// that is reported but not obeyed — a build whose `effectiveBand` is computed for
// the snapshot while its contact code still compares stored bands — passes both
// of those and loses the mechanic the case is named for. Only a real shot catches
// it.
//
// Both directions are read in one check because the requirement IS the
// discrimination: with an inversion running, two stored-magenta Shards standing
// side by side, the CYAN shot destroys and the MAGENTA one does not — the exact
// reverse of the outcome the same two shots have with no inversion. A build that
// ignores the inversion in its contact code gets both readings wrong, and each is
// named separately in the failure.
//
// The Shards stand 480 units apart, each shot is placed on its own target's
// lane, and the second Shard is what keeps the wave holding a drone after the
// first is destroyed, so no reading of the stage-clear rule (specs/stages.md) can
// end the wave under the second shot.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertEqual, assertUndefined } from "../assert";
import { INVERSION_TIME } from "../constants";
import {
  captureStill,
  createHarness,
  droneById,
  poseDrone,
  shootDrone,
  startPosed,
  type Harness,
} from "../harness";

/** Where the Shard the cyan shot must destroy stands. */
const TAKEN = { x: 400, y: 300 } as const;

/** Where the Shard the magenta shot must leave standing stands, 480 units clear. */
const SPARED = { x: 880, y: 300 } as const;

/**
 * How far below its target each shot is placed, in logical units.
 *
 * Seven times the 20-unit contact reach a Shard has against one of the player's
 * bullets (`SHARD_HALF` 14 + `PLAYER_BULLET_HALF` 6).
 */
const SHOT_BELOW = 140;

/**
 * Frames each flight is allowed.
 *
 * At `PLAYER_BULLET_SPEED` (760), 7.6 units per frame of the harness's 100 Hz
 * clock: the contact reach is entered inside 16 frames, and 30 leaves slack for
 * whichever frame a build resolves it on. Both flights together cost at most
 * 0.6 s, an eighth of `INVERSION_TIME` (5), so the inversion is still running for
 * the second one.
 */
const SHOT_FRAMES = 30;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("destroys the stored-magenta Shard with cyan and spares it with magenta", async () => {
  await startPosed(harness);
  const taken = await poseDrone(harness, "shard", TAKEN.x, TAKEN.y, {
    band: "magenta",
  });
  const spared = await poseDrone(harness, "shard", SPARED.x, SPARED.y, {
    band: "magenta",
  });
  await harness.debug.setInversion(INVERSION_TIME);

  const cyanShot = await shootDrone(harness, taken, "cyan", {
    below: SHOT_BELOW,
    maxFrames: SHOT_FRAMES,
  });
  const magentaShot = await shootDrone(harness, spared, "magenta", {
    below: SHOT_BELOW,
    maxFrames: SHOT_FRAMES,
  });
  await captureStill(harness, "outcome");

  assertEqual(
    magentaShot.snapshot.inversionActive,
    true,
    "the inversion still running when both shots had resolved",
  );
  assertEqual(cyanShot.hit, true, "the cyan shot resolving inside its flight");
  assertUndefined(
    droneById(magentaShot.snapshot, taken),
    "the stored-magenta Shard a CYAN shot destroys under an inversion (specs/bands.md)",
  );
  assertDefined(
    droneById(magentaShot.snapshot, spared),
    "the stored-magenta Shard a MAGENTA shot must not destroy under an inversion (specs/bands.md)",
  );
});
