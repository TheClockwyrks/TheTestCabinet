// scoring/shard-formation — a formation Shard pays its figure.
//
// THE RULE. specs/scoring.md's first table: "A Shard in phase `formation`" pays
// `SCORE_SHARD_FORM` (`50`). This point decides that one figure, read as the
// whole change the kill made to the score.
//
// WHY THE FIGURE IS THE DISTINGUISHING VALUE. `50` is the only figure in the
// table a formation Shard can be confused for: a build that pays the DIVING
// figure whatever the phase reads `100`, one that pays a Flux's formation figure
// reads `80`, one that pays a flat rate reads whatever that rate is, and one that
// pays nothing reads `0`. Each wrong model therefore lands on a different number,
// so the failure names which one the build implemented rather than only saying
// the score was wrong.
//
// THE SCENARIO IS ONE SHOT AND NOTHING ELSE. `startPosed` empties the four
// rosters, shuts the three world gates and opens the run at a score of `0`, so
// the number read at the end is the payment and nothing else. The Shard is posed
// with every faculty off — a Shard's band is fixed for its life (specs/drones.md)
// — so it is holding the band it was given, in the phase it was given, when the
// bullet reaches it. One of the player's bullets carrying the Shard's own band
// destroys it (specs/bands.md), and the build's own contact, band and scoring
// rules do the rest.
//
// WHY A BYSTANDER STANDS IN THE CORNER. See `scene.ts`: a stage clears in the
// moment the last drone of its wave is destroyed (specs/stages.md), and a build
// that reads "its wave" as the drones on the field would clear this stage under
// the kill and pay `SCORE_STAGE_CLEAR` into the very number this check reads.
//
// WHAT THIS DOES NOT DECIDE. That a matching shot destroys a drone at all is
// `bands.match-destroys`, and it is read here as the precondition of a payment.
// What a DIVING Shard pays is `scoring.shard-diving`, and what clearing a stage
// pays is `scoring.stage-clear-bonus`.

import { afterEach, beforeEach, it } from "vitest";
import { SCORE_SHARD_FORM } from "../constants";
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

it("adds exactly SCORE_SHARD_FORM when a formation Shard is destroyed", async () => {
  startPosed(h);
  poseBystander(h);
  // Phase `formation` is what `addDrone` gives, and `poseDrone` leaves every
  // faculty off, so the Shard holds its centre, its band and its phase.
  const target = poseDrone(h, "shard", TARGET_AT.x, TARGET_AT.y, {
    band: MATCHING_BAND,
    phase: "formation",
  });

  const before = h.snapshot();
  assertEqual(before.score, 0, "precondition: the run opens with a score of 0");
  assertEqual(
    requireDrone(before, target, "the Shard the shot destroys, as posed").phase,
    "formation",
    "precondition: the Shard is in phase formation when the shot reaches it",
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
    SCORE_SHARD_FORM,
    `the score after one Shard in phase formation was destroyed ` +
      `(specs/scoring.md: a Shard in phase formation pays SCORE_SHARD_FORM, ` +
      `${SCORE_SHARD_FORM})`,
  );
});
