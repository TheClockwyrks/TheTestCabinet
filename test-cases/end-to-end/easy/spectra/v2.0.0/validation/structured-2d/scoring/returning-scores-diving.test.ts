// scoring/returning-scores-diving — a returning drone pays the diving figure.
//
// THE RULE. specs/scoring.md pays one figure for three phases: "A Shard in phase
// `entering`, `diving`, or `returning`" pays `SCORE_SHARD_DIVE` (`100`).
// `returning` is the phase a drone holds while it loops back to its slot after a
// dive (specs/swarm.md), and this point decides that a drone destroyed there is
// paid at the diving figure rather than at the formation one.
//
// WHY THIS IS ITS OWN POINT. A build that reads "diving" literally pays
// `SCORE_SHARD_FORM` (`50`) for every phase that is not `diving`, and a build
// that treats a returning drone as already back in its block does the same. Both
// score a diving Shard correctly and this one wrongly, so the phases grade apart:
// `50` against `100`, with `0` for a build that pays nothing.
//
// THE DRONE IS RETURNING AND DOING NOTHING ELSE. `poseDrone` leaves every faculty
// off, so the travel gate holds the drone at its centre and keeps its phase
// (specs/instrumentation.md) — a returning drone left to travel would reach its
// slot and enter `formation`, which is the other figure and would decide this
// point by accident.
//
// WHAT THIS DOES NOT DECIDE. The figure itself is `scoring.shard-diving`; this
// point decides only that the `returning` phase is paid at it. `entering` is
// `scoring.entering-scores-diving`.

import { afterEach, beforeEach, it } from "vitest";
import { SCORE_SHARD_DIVE } from "../constants";
import { assertEqual, assertUndefined } from "../assert";
import {
  captureStill,
  createHarness,
  droneById,
  poseDrone,
  startPosed,
  type Harness,
} from "../harness";
import { requireDrone, shootDrone } from "./scene";

/**
 * Where the Shard is posed, in logical units.
 *
 * A clear stretch of the play field: below the formation grid's lowest row
 * (`332`) and its full sway, above the ship's lane (`SHIP_Y`, `600`).
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

it("adds SCORE_SHARD_DIVE when a Shard in phase returning is destroyed", async () => {
  startPosed(h);
  const target = poseDrone(h, "shard", TARGET_AT.x, TARGET_AT.y, {
    band: MATCHING_BAND,
    phase: "returning",
  });

  const before = h.snapshot();
  assertEqual(before.score, 0, "precondition: the run opens with a score of 0");
  assertEqual(
    requireDrone(before, target, "the Shard the shot destroys, as posed").phase,
    "returning",
    "precondition: the Shard is in phase returning when the shot reaches it",
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
    `the score after one Shard in phase returning was destroyed ` +
      `(specs/scoring.md: a Shard in phase entering, diving, or returning pays ` +
      `SCORE_SHARD_DIVE, ${SCORE_SHARD_DIVE}, not the formation figure)`,
  );
});
