// scoring/entering-scores-diving — an entering drone pays the diving figure.
//
// THE RULE. specs/scoring.md pays ONE figure for THREE phases: "A Shard in phase
// `entering`, `diving`, or `returning`" pays `SCORE_SHARD_DIVE` (`100`).
// `entering` is the phase a drone holds while it flies in from off the field
// (specs/swarm.md), and this point decides that a drone destroyed there is paid at
// the diving figure rather than at the formation one.
//
// WHY THIS IS ITS OWN POINT. The rule that decides WHICH figure is paid is the one
// a build gets wrong, and the natural mistake is to read "diving" literally and
// pay `SCORE_SHARD_FORM` (`50`) for every phase that is not `diving`. That build
// scores a diving Shard correctly and this one wrongly, so the two must grade
// apart: `50` against `100` is exactly the distinguishing pair, with `0` for a
// build that pays an entering drone nothing.
//
// THE DRONE IS ENTERING AND DOING NOTHING ELSE. `poseDrone` leaves every faculty
// off, so the travel gate holds the drone at its centre and keeps its phase
// (specs/instrumentation.md). An entering drone left to travel would fly its
// entrance path out from under the shot and settle into `formation`, which is the
// OTHER figure and would decide this point by accident.
//
// WHY A BYSTANDER STANDS IN THE CORNER. {@link poseBystander} states it in full:
// one inert drone standing keeps the wave live under either reading of "the last
// drone of its wave" (specs/stages.md), so no `SCORE_STAGE_CLEAR` lands in the
// number this check reads.
//
// WHAT THIS DOES NOT DECIDE. The figure itself is `scoring/shard-diving`'s; this
// point decides only that the `entering` phase is paid at it. `returning` is
// `scoring/returning-scores-diving`.

import { afterEach, beforeEach, it } from "vitest";
import {
  PLAYER_BULLET_HALF,
  SCORE_SHARD_DIVE,
  SCORE_SHARD_FORM,
  SHARD_HALF,
} from "../constants";
import { assertEqual, assertNull } from "../assert";
import {
  SHOT_GAP,
  captureStill,
  createHarness,
  droneOf,
  fireAt,
  findDrone,
  poseDrone,
  startPosed,
  type Harness,
} from "../harness";
import { poseBystander } from "./wave";

/**
 * Where the Shard is posed, in logical units.
 *
 * A clear stretch of the play field: below the formation grid's lowest row
 * (`slotY(4)`, `332`) and its full sway, above the ship's lane (`SHIP_Y`, `600`),
 * and well clear of the corner the bystander holds.
 */
const TARGET_AT = { x: 900, y: 460 } as const;

/** The band the Shard holds and the shot carries: a match by specs/bands.md. */
const MATCHING_BAND = "cyan" as const;

/**
 * How far below the Shard the shot starts: the harness's own {@link SHOT_GAP}.
 *
 * Geometry, not a tolerance. `SHOT_GAP` (`60`) clears the contact circle the two
 * make together — `SHARD_HALF` (`14`) plus `PLAYER_BULLET_HALF` (`6`) is `20` —
 * three times over.
 */
const CLEARANCE = SHOT_GAP - (SHARD_HALF + PLAYER_BULLET_HALF);

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
    droneOf(before, target).phase,
    "entering",
    "precondition: the Shard is in phase entering when the shot reaches it",
  );

  await fireAt(h, TARGET_AT.x, TARGET_AT.y, MATCHING_BAND, SHOT_GAP);

  // The score the kill left, on the frame the shot resolved.
  captureStill(h, "paid");

  const after = h.snapshot();
  assertNull(
    findDrone(after, target),
    `precondition: the ${MATCHING_BAND} shot destroyed the ${MATCHING_BAND} ` +
      `Shard, having started ${CLEARANCE} units clear of its contact circle ` +
      "(specs/bands.md)",
  );
  assertEqual(
    after.score,
    SCORE_SHARD_DIVE,
    "the score after one Shard in phase entering was destroyed " +
      "(specs/scoring.md: a Shard in phase entering, diving, or returning pays " +
      `SCORE_SHARD_DIVE, ${SCORE_SHARD_DIVE}, not the formation figure ` +
      `SCORE_SHARD_FORM, ${SCORE_SHARD_FORM})`,
  );
});
