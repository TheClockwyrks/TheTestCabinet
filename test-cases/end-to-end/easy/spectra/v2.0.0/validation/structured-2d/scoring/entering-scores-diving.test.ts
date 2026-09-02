// scoring/entering-scores-diving — an entering drone pays the diving figure.
//
// THE RULE. specs/scoring.md pays one figure for three phases: "A Shard in phase
// `entering`, `diving`, or `returning`" pays `SCORE_SHARD_DIVE` (`100`).
// `entering` is the phase a drone holds while it flies in from off the field
// (specs/swarm.md), and this point decides that a drone destroyed there is paid
// at the diving figure rather than at the formation one.
//
// WHY THIS IS ITS OWN POINT. The rule that decides WHICH figure is paid is the
// one a build gets wrong: the natural mistake is to read "diving" literally and
// pay `SCORE_SHARD_FORM` (`50`) for every phase that is not `diving`. That build
// scores a diving Shard correctly and this one wrongly, so the two must grade
// apart. `50` against `100` is exactly the distinguishing pair, and a build that
// pays nothing for an entering drone reads `0`.
//
// THE DRONE IS ENTERING AND DOING NOTHING ELSE. `poseDrone` leaves every faculty
// off, so the travel gate holds the drone at its centre and keeps its phase
// (specs/instrumentation.md) — an entering drone left to travel would fly its
// entrance path out from under the shot and settle into `formation`, which is the
// other figure and would decide this point by accident.
//
// WHY A BYSTANDER STANDS IN THE CORNER. See `scene.ts`: it leaves a drone
// standing, so no `SCORE_STAGE_CLEAR` lands in the number this check reads.
//
// WHAT THIS DOES NOT DECIDE. The figure itself is `scoring.shard-diving`; this
// point decides only that the `entering` phase is paid at it. `returning` is
// `scoring.returning-scores-diving`.

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

it("adds SCORE_SHARD_DIVE when a Shard in phase entering is destroyed", async () => {
  startPosed(h);
  poseBystander(h);
  const target = poseDrone(h, "shard", TARGET_AT.x, TARGET_AT.y, {
    band: MATCHING_BAND,
    phase: "entering",
  });

  const before = h.snapshot();
  assertEqual(before.score, 0, "precondition: the run opens with a score of 0");
  assertEqual(
    requireDrone(before, target, "the Shard the shot destroys, as posed").phase,
    "entering",
    "precondition: the Shard is in phase entering when the shot reaches it",
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
    `the score after one Shard in phase entering was destroyed ` +
      `(specs/scoring.md: a Shard in phase entering, diving, or returning pays ` +
      `SCORE_SHARD_DIVE, ${SCORE_SHARD_DIVE}, not the formation figure)`,
  );
});
