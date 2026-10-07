// Spectra — scoring/shard-diving: a diving Shard pays its figure.
//
// THE RULE. `specs/scoring.md`'s first table: "A Shard in phase `entering`,
// `diving`, or `returning`" pays `SCORE_SHARD_DIVE` (`100`). This point decides
// that figure for the phase the rule is named after, `diving`.
//
// WHY THE FIGURE IS THE DISTINGUISHING VALUE. `100` is twice the `50` a
// formation Shard pays, so a build that ignores the phase and pays one flat
// Shard figure reads `50` here, one that pays a Flux's diving figure reads
// `160`, and one that pays nothing reads `0`. Each wrong model lands on a
// different number, and the failure names it.
//
// THE DRONE IS DIVING AND DOING NOTHING ELSE. `setDronePhase` puts it in phase
// `diving` and `poseDrone` leaves every faculty off, so — as
// `specs/instrumentation.md` states of the travel gate — it "holds its exact
// center and keeps its phase; nothing is cancelled, completed, or resolved
// early". A drone that flew its dive would move out from under the shot and,
// with its fire gate on, would put an enemy bullet into a scenario that is about
// a number. What a dive's PATH and its FIRE do belong to `swarm`'s items; this
// one needs the phase alone.
//
// WHAT THIS DOES NOT DECIDE. That a matching shot destroys a drone is
// `bands/match-destroys`. That the other two moving phases pay this same figure
// is `scoring/entering-scores-diving` and `scoring/returning-scores-diving`, each
// its own point so a failed grade names the phase.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertUndefined } from "../assert";
import { SCORE_SHARD_DIVE } from "../constants";
import {
  captureStill,
  createHarness,
  droneById,
  poseDrone,
  requireDrone,
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
 * Clear of the drone — `SHARD_HALF` (`14`) plus the bullet's
 * `PLAYER_BULLET_HALF` (`6`) is `20` — with room to spare, so the bullet is in
 * flight rather than already in contact.
 */
const SHOT_BELOW = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("adds exactly SCORE_SHARD_DIVE when a diving Shard is destroyed", async () => {
  await startPosed(h);
  const target = await poseDrone(h, "shard", TARGET_AT.x, TARGET_AT.y, {
    band: "cyan",
    phase: "diving",
  });

  const before = await h.snapshot();
  assertEqual(before.score, 0, "precondition: the run opens with a score of 0");
  assertEqual(
    requireDrone(before, target, "the Shard the shot destroys").phase,
    "diving",
    "precondition: the Shard is in phase diving when the shot reaches it",
  );

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
    SCORE_SHARD_DIVE,
    `the score after one Shard in phase diving was destroyed ` +
      `(specs/scoring.md: a Shard in phase entering, diving, or returning pays ` +
      `SCORE_SHARD_DIVE, ${SCORE_SHARD_DIVE})`,
  );
});
