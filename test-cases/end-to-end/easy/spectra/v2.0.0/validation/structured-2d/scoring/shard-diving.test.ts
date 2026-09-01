// scoring/shard-diving — a diving Shard pays its figure.
//
// THE RULE. specs/scoring.md's first table: "A Shard in phase `entering`,
// `diving`, or `returning`" pays `SCORE_SHARD_DIVE` (`100`). This point decides
// that figure for the phase the rule is named after, `diving`.
//
// WHY THE FIGURE IS THE DISTINGUISHING VALUE. `100` is twice the `50` a formation
// Shard pays, so a build that ignores the phase and pays one flat Shard figure
// reads `50` here, one that pays a Flux's diving figure reads `160`, and one that
// pays nothing reads `0`. Each wrong model lands on a different number, and the
// failure names it.
//
// THE DRONE IS DIVING AND DOING NOTHING ELSE. `poseDrone` leaves every faculty
// off, so — as specs/instrumentation.md states of the travel gate — the Shard
// "holds its exact center and keeps its phase; nothing is cancelled, completed,
// or resolved early". A drone that flew its dive would move out from under the
// shot and, with its fire gate on, would put an enemy bullet into a scenario that
// is about a number. What a dive's PATH and its FIRE do belong to `swarm`'s
// items; this one needs the phase alone.
//
// WHY A BYSTANDER STANDS IN THE CORNER. See `scene.ts`: it leaves a drone
// standing, so no `SCORE_STAGE_CLEAR` lands in the number this check reads.
//
// WHAT THIS DOES NOT DECIDE. That a matching shot destroys a drone is
// `bands.match-destroys`. That the other two moving phases pay this same figure
// is `scoring.entering-scores-diving` and `scoring.returning-scores-diving`, each
// its own point so a failed grade names the phase.

import { afterEach, beforeEach, it } from "vitest";
import { SCORE_SHARD_DIVE } from "../../src/constants";
import { assertEqual, assertUndefined } from "../assert";
import {
  captureStill,
  createHarness,
  droneById,
  poseDrone,
  startPosed,
  type Harness,
} from "../harness";
import { poseBystander, requireDrone, shootDrone } from "./scene";

/**
 * Where the Shard is posed, in logical units.
 *
 * A clear stretch of the play field: below the formation grid's lowest row
 * (`332`) and its full sway, above the ship's lane (`SHIP_Y`, `600`), and well
 * clear of the corner the bystander holds.
 */
const TARGET_AT = { x: 900, y: 460 } as const;

/** The band both the drone and the shot carry: a match by specs/bands.md. */
const MATCHING_BAND = "cyan" as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("adds exactly SCORE_SHARD_DIVE when a diving Shard is destroyed", async () => {
  startPosed(h);
  poseBystander(h);
  const target = poseDrone(h, "shard", TARGET_AT.x, TARGET_AT.y, {
    band: MATCHING_BAND,
    phase: "diving",
  });

  const before = h.snapshot();
  assertEqual(before.score, 0, "precondition: the run opens with a score of 0");
  assertEqual(
    requireDrone(before, target, "the Shard the shot destroys, as posed").phase,
    "diving",
    "precondition: the Shard is in phase diving when the shot reaches it",
  );

  await shootDrone(h, target, MATCHING_BAND);

  // The score the kill left, on the frame the shot resolved.
  captureStill(h, "paid");

  const after = h.snapshot();
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
