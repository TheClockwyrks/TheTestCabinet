// Spectra — scoring/shard-formation: a formation Shard pays its figure.
//
// THE RULE. `specs/scoring.md`'s first table: "A Shard in phase `formation`"
// pays `SCORE_SHARD_FORM` (`50`). This point decides that one figure, read as
// the whole change the kill made to the score.
//
// WHY THE FIGURE IS THE DISTINGUISHING VALUE. `50` is the only figure in the
// table a formation Shard can be confused for: a build that pays the DIVING
// figure whatever the phase reads `100`, one that pays a Flux's formation
// figure reads `80`, one that pays a flat rate reads whatever that is, and one
// that pays nothing reads `0`. Each wrong model therefore lands on a different
// number, so the failure names which one the build implemented rather than only
// saying the score was wrong.
//
// THE SCENARIO IS ONE SHOT AND NOTHING ELSE. `startPosed` empties the four
// rosters, shuts the wave's three gates and opens the run at a score of `0`, so
// the number read at the end is the payment and nothing else. The Shard is posed
// with every faculty off — a Shard's band is fixed for its life
// (`specs/drones.md`), so it is holding the band it was given, in the phase it
// was given, when the bullet reaches it. One of the player's bullets carrying
// the Shard's own band destroys it (`specs/bands.md`), and the build's own
// contact, band and scoring rules do the rest.
//
// WHAT THIS DOES NOT DECIDE. That a matching shot destroys a drone at all is
// `bands/match-destroys`, and it is read here as the precondition of a payment.
// What a DIVING Shard pays is `scoring/shard-diving`, and what clearing a stage
// pays is `scoring/stage-clear-bonus`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertUndefined } from "../assert";
import { SCORE_SHARD_FORM } from "../constants";
import {
  captureStill,
  createHarness,
  droneById,
  poseDrone,
  shootDrone,
  startPosed,
  type Harness,
} from "../harness";

/**
 * Where the Shard is posed: a clear stretch of the play field, below the
 * formation grid's lowest row (`332`) and its full sway, above the ship's lane
 * (`SHIP_Y`, `600`).
 */
const TARGET_AT = { x: 900, y: 460 } as const;

/**
 * How far below the Shard the shot starts, in logical units.
 *
 * Clear of the drone at the moment it is placed — `SHARD_HALF` (`14`) plus the
 * bullet's `PLAYER_BULLET_HALF` (`6`) is `20` — with room to spare, so the
 * bullet is in flight rather than already in contact, and short enough that it
 * climbs into a drone that is holding still.
 */
const SHOT_BELOW = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("adds exactly SCORE_SHARD_FORM when a formation Shard is destroyed", async () => {
  await startPosed(h);
  // Phase `formation` is what `addDrone` gives, and `poseDrone` leaves every
  // faculty off, so the Shard holds its centre, its band and its phase.
  const target = await poseDrone(h, "shard", TARGET_AT.x, TARGET_AT.y, {
    band: "cyan",
    phase: "formation",
  });

  const before = await h.snapshot();
  assertEqual(before.score, 0, "precondition: the run opens with a score of 0");

  await shootDrone(h, target, "cyan", { below: SHOT_BELOW });

  // The score the kill left, on the frame the shot resolved.
  await captureStill(h, "paid");

  const after = await h.snapshot();
  assertUndefined(
    droneById(after, target),
    "precondition: the cyan shot destroyed the cyan Shard (specs/bands.md)",
  );
  assertEqual(
    after.score,
    SCORE_SHARD_FORM,
    `the score after one Shard in phase formation was destroyed ` +
      `(specs/scoring.md: a Shard in phase formation pays SCORE_SHARD_FORM, ` +
      `${SCORE_SHARD_FORM})`,
  );
});
