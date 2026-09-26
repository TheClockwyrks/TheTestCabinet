// scoring/shard-formation — a formation Shard pays its figure.
//
// THE RULE. specs/scoring.md's first table: "A Shard in phase `formation`" pays
// `SCORE_SHARD_FORM` (`50`). This point decides that one figure, read as the
// whole change the kill made to the score.
//
// WHY THE FIGURE IS THE DISTINGUISHING VALUE. `50` is unlike every figure a
// formation Shard could be confused for: a build that pays the DIVING figure
// whatever the phase reads `100`, one that pays a Flux's formation figure reads
// `80`, one that pays a flat rate reads whatever that rate is, and one that pays
// nothing reads `0`. Each wrong model therefore lands on a different number, so a
// failure names which one the build implemented rather than only saying the score
// was wrong.
//
// THE SCENARIO IS ONE SHOT AND NOTHING ELSE. `startPosed` empties the rosters,
// shuts the three world gates and opens the run at a score of `0`, so the number
// read at the end is the payment. The Shard is posed with every faculty off — a
// Shard's band is fixed for its life (specs/drones.md) — so it is holding the
// band it was given, in the phase it was given, when the bullet reaches it. One of
// the player's bullets carrying that same band destroys it (specs/bands.md), and
// the build's own contact, band and scoring rules do the rest.
//
// WHAT THIS DOES NOT DECIDE. That a matching shot destroys a drone at all is
// `bands/match-destroys`, and it is read here as the precondition of a payment.
// What a DIVING Shard pays is `scoring/shard-diving`; what clearing a stage pays
// is `scoring/stage-clear-bonus`.

import { afterEach, beforeEach, it } from "vitest";
import { PLAYER_BULLET_HALF, SCORE_SHARD_FORM, SHARD_HALF } from "../constants";
import { assertEqual, assertNull } from "../assert";
import {
  SHOT_GAP,
  captureStill,
  createHarness,
  fireAt,
  findDrone,
  poseDrone,
  startPosed,
  type Harness,
} from "../harness";

/**
 * Where the Shard is posed, in logical units.
 *
 * A clear stretch of the play field: below the formation grid's lowest row
 * (`slotY(4)`, `332`) and its full sway, above the ship's lane (`SHIP_Y`,
 * `600`).
 */
const TARGET_AT = { x: 900, y: 460 } as const;

/** The band the Shard holds and the shot carries: a match by specs/bands.md. */
const MATCHING_BAND = "cyan" as const;

/**
 * How far below the Shard the shot starts: the harness's own {@link SHOT_GAP}.
 *
 * Geometry, not a tolerance. `SHOT_GAP` (`60`) clears the contact circle the two
 * make together — `SHARD_HALF` (`14`) plus `PLAYER_BULLET_HALF` (`6`) is `20` —
 * three times over, so the bullet is unmistakably in flight when it is placed.
 */
const CLEARANCE = SHOT_GAP - (SHARD_HALF + PLAYER_BULLET_HALF);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("adds exactly SCORE_SHARD_FORM when a formation Shard is destroyed", async () => {
  startPosed(h);
  // Phase `formation` is what `addDrone` gives, and `poseDrone` leaves every
  // faculty off, so the Shard holds its centre, its band and its phase.
  const target = poseDrone(h, "shard", TARGET_AT.x, TARGET_AT.y, {
    band: MATCHING_BAND,
    phase: "formation",
  });

  assertEqual(
    h.snapshot().score,
    0,
    "precondition: the run opens with a score of 0",
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
    SCORE_SHARD_FORM,
    "the score after one Shard in phase formation was destroyed " +
      "(specs/scoring.md: a Shard in phase formation pays SCORE_SHARD_FORM, " +
      `${SCORE_SHARD_FORM})`,
  );
});
