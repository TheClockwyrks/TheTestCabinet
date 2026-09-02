// bands/inversion-changes-outcome — an inversion changes what a shot destroys.
//
// The two sibling points read the inversion off the SNAPSHOT: what a drone reports
// as its effective band. This one reads it off the GAME. specs/bands.md decides a
// contact by the two effective bands "and nothing else does", so an inversion that
// is reported but not obeyed — a build whose `effectiveBand` is computed for the
// snapshot while its contact code still compares stored bands — passes both of
// those and loses the mechanic the case is named for. Only a real shot catches it.
//
// BOTH DIRECTIONS ARE READ IN ONE CHECK BECAUSE THE REQUIREMENT IS THE
// DISCRIMINATION. With an inversion running, two stored-magenta Shards stand side
// by side: the CYAN shot destroys and the MAGENTA one does not — the exact reverse
// of the outcome those same two shots have with no inversion. A build that ignores
// the inversion in its contact code gets both readings wrong, and each is named
// separately in the failure, so which way it is wrong is legible.
//
// THE TWO SHARDS STAND 480 UNITS APART and each shot is placed on its own target's
// column, so neither flight can reach the other's drone. The second Shard is also
// what keeps the wave holding a drone after the first is destroyed, so no reading
// of the stage-clear rule (specs/stages.md, "in the moment the last drone of its
// wave is destroyed") can end the wave under the second shot. It is not a
// bystander parked to soak up a rule: it is the drone the second half of the
// requirement is fired at.

import { afterEach, beforeEach, it } from "vitest";
import {
  INVERSION_TIME,
  PLAYER_BULLET_HALF,
  SHARD_HALF,
} from "../constants";
import { assertDefined, assertEqual, assertUndefined } from "../assert";
import {
  captureStill,
  createHarness,
  droneById,
  fireAt,
  poseDrone,
  seconds,
  startPosed,
  type Harness,
} from "../harness";

/** Where the Shard the cyan shot must destroy stands, in logical units. */
const TAKEN_X = 400;
const TAKEN_Y = 320;

/** Where the Shard the magenta shot must leave standing stands, 480 units clear. */
const SPARED_X = 880;
const SPARED_Y = 320;

/** The stored band both Shards carry: magenta, which an inversion reads as cyan. */
const STORED = "magenta" as const;

/** The contact reach: `SHARD_HALF` (`14`) + `PLAYER_BULLET_HALF` (`6`). */
const TOUCHING = SHARD_HALF + PLAYER_BULLET_HALF;

/** How far below its target each shot starts: seven times the contact reach. */
const SHOT_BELOW = 7 * TOUCHING;

/**
 * Frames each flight is allowed.
 *
 * At `PLAYER_BULLET_SPEED` (`760`, specs/ship.md) the contact reach is entered
 * after 120 units, inside 16 frames of the harness's 100 Hz clock, and 30 leaves
 * slack for whichever sub-step a build resolves the contact on. Both flights
 * together cost {@link BOTH_FLIGHTS} seconds, a small fraction of `INVERSION_TIME`
 * (`5.0`), so the inversion posed before the first is still running through the
 * second — which the check reads rather than assumes.
 */
const FLIGHT_TICKS = 30;

/** What both flights cost the running inversion, in seconds. */
const BOTH_FLIGHTS = seconds(2 * FLIGHT_TICKS);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("destroys the stored-magenta Shard with cyan and spares it with magenta", async () => {
  startPosed(h);
  const taken = poseDrone(h, "shard", TAKEN_X, TAKEN_Y, { band: STORED });
  const spared = poseDrone(h, "shard", SPARED_X, SPARED_Y, { band: STORED });
  h.debug.setInversion(INVERSION_TIME);

  await fireAt(h, TAKEN_X, TAKEN_Y, "cyan", SHOT_BELOW, FLIGHT_TICKS);
  await fireAt(h, SPARED_X, SPARED_Y, "magenta", SHOT_BELOW, FLIGHT_TICKS);
  captureStill(h, "outcome");

  const after = h.snapshot();
  assertEqual(
    after.inversionActive,
    true,
    `the inversion still running when both shots had resolved, ` +
      `${BOTH_FLIGHTS} s of INVERSION_TIME ${INVERSION_TIME} having been spent`,
  );
  assertUndefined(
    droneById(after, taken),
    `the stored-${STORED} Shard a CYAN shot destroys under an inversion, both ` +
      `reading cyan by the effective-band rule (specs/bands.md)`,
  );
  assertDefined(
    droneById(after, spared),
    `the stored-${STORED} Shard a MAGENTA shot must not destroy under an ` +
      `inversion, the drone reading cyan against the shot's magenta ` +
      `(specs/bands.md)`,
  );
});
