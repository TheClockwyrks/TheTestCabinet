// Spectra — scoring/entering-scores-diving: an entering drone pays the diving
// figure.
//
// THE RULE. `specs/scoring.md` pays one figure for three phases: "A Shard in
// phase `entering`, `diving`, or `returning`" pays `SCORE_SHARD_DIVE` (`100`).
// `entering` is the phase a drone holds while it flies in from above the field
// (`specs/swarm.md`), and this point decides that a drone destroyed there is
// paid at the diving figure rather than at the formation one.
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
// (`specs/instrumentation.md`) — an entering drone left to travel would fly its
// entrance path out from under the shot and settle into `formation`, which is
// the other figure and would decide this point by accident.
//
// WHAT THIS DOES NOT DECIDE. The figure itself is `scoring/shard-diving`; this
// point decides only that the `entering` phase is paid at it. `returning` is
// `scoring/returning-scores-diving`.

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
 * `PLAYER_BULLET_HALF` (`6`) is `20` — with room to spare.
 */
const SHOT_BELOW = 60;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("adds SCORE_SHARD_DIVE when a Shard in phase entering is destroyed", async () => {
  await startPosed(h);
  const target = await poseDrone(h, "shard", TARGET_AT.x, TARGET_AT.y, {
    band: "cyan",
    phase: "entering",
  });

  const before = await h.snapshot();
  assertEqual(before.score, 0, "precondition: the run opens with a score of 0");
  assertEqual(
    requireDrone(before, target, "the Shard the shot destroys").phase,
    "entering",
    "precondition: the Shard is in phase entering when the shot reaches it",
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
    `the score after one Shard in phase entering was destroyed ` +
      `(specs/scoring.md: a Shard in phase entering, diving, or returning pays ` +
      `SCORE_SHARD_DIVE, ${SCORE_SHARD_DIVE}, not the formation figure)`,
  );
});
