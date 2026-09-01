// scoring/flux-formation — a formation Flux pays its figure.
//
// THE RULE. specs/scoring.md's first table: "A Flux in phase `formation`" pays
// `SCORE_FLUX_FORM` (`80`). This point decides that one figure.
//
// WHY THE FIGURE IS THE DISTINGUISHING VALUE. `80` is unlike every neighbouring
// figure in the table: a build that pays one figure per phase whatever the kind
// reads `50` (the Shard's formation figure), one that ignores the phase and pays a
// Flux's diving figure reads `160`, and one that pays nothing reads `0`. Each
// wrong model lands on its own number, so the failure names it.
//
// THE FLUX IS HELD ON ITS BAND, AND THAT IS WHY THE SHOT LANDS. A Flux alternates
// between the bands on a telegraphed rhythm, and "No shot destroys a shimmering
// Flux, of either band" (specs/drones.md). So the drone is posed with its band
// clock at `0` — the start of a window, well below `fluxHold(stage)` — and its
// oscillation gate OFF, which holds it wherever it stands
// (specs/instrumentation.md). It is therefore holding cyan for the whole of the
// shot's flight, and the shot is the plain matching case specs/bands.md states.
// The rhythm itself is `drones`'s to grade; here it is only kept out of the way,
// and the `shimmer` flag is read back as the precondition it is.
//
// WHY A BYSTANDER STANDS IN THE CORNER. {@link poseBystander} states it in full:
// one inert drone standing keeps the wave live under either reading of "the last
// drone of its wave" (specs/stages.md), so no `SCORE_STAGE_CLEAR` lands in the
// number this check reads.
//
// WHAT THIS DOES NOT DECIDE. That a matching shot destroys a held Flux is
// `bands`'s and `drones`'s; it is read here as the precondition of a payment. What
// a DIVING Flux pays is `scoring/flux-diving`.

import { afterEach, beforeEach, it } from "vitest";
import {
  FLUX_HALF,
  PLAYER_BULLET_HALF,
  SCORE_FLUX_FORM,
} from "../../src/constants";
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
 * Where the Flux is posed, in logical units.
 *
 * A clear stretch of the play field: below the formation grid's lowest row
 * (`slotY(4)`, `332`) and its full sway, above the ship's lane (`SHIP_Y`, `600`),
 * and well clear of the corner the bystander holds.
 */
const TARGET_AT = { x: 900, y: 460 } as const;

/** The band the Flux holds and the shot carries: a match by specs/bands.md. */
const MATCHING_BAND = "cyan" as const;

/**
 * How far into its band window the Flux stands when the shot is fired.
 *
 * `0` is the start of a window, which specs/drones.md puts squarely in the HELD
 * part: the shimmer begins only at `fluxHold(stage)`, `FLUX_HOLD_L1` (`1.6`)
 * seconds at stage 1. With the oscillation gate off the clock does not advance, so
 * the Flux holds its stored band throughout.
 */
const HELD_CLOCK = 0;

/**
 * How far below the Flux the shot starts: the harness's own {@link SHOT_GAP}.
 *
 * Geometry, not a tolerance. `SHOT_GAP` (`60`) clears the contact circle the two
 * make together — `FLUX_HALF` (`15`) plus `PLAYER_BULLET_HALF` (`6`) is `21` —
 * nearly three times over.
 */
const CLEARANCE = SHOT_GAP - (FLUX_HALF + PLAYER_BULLET_HALF);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("adds exactly SCORE_FLUX_FORM when a formation Flux is destroyed", async () => {
  startPosed(h);
  poseBystander(h);
  const target = poseDrone(h, "flux", TARGET_AT.x, TARGET_AT.y, {
    band: MATCHING_BAND,
    phase: "formation",
    bandClock: HELD_CLOCK,
  });

  const before = h.snapshot();
  assertEqual(before.score, 0, "precondition: the run opens with a score of 0");
  assertEqual(
    droneOf(before, target).shimmer,
    false,
    "precondition: the Flux is holding a band rather than shimmering " +
      "(specs/drones.md: no shot destroys a shimmering Flux)",
  );

  await fireAt(h, TARGET_AT.x, TARGET_AT.y, MATCHING_BAND, SHOT_GAP);

  // The score the kill left, on the frame the shot resolved.
  captureStill(h, "paid");

  const after = h.snapshot();
  assertNull(
    findDrone(after, target),
    `precondition: the ${MATCHING_BAND} shot destroyed the held ` +
      `${MATCHING_BAND} Flux, having started ${CLEARANCE} units clear of its ` +
      "contact circle (specs/bands.md)",
  );
  assertEqual(
    after.score,
    SCORE_FLUX_FORM,
    "the score after one Flux in phase formation was destroyed " +
      "(specs/scoring.md: a Flux in phase formation pays SCORE_FLUX_FORM, " +
      `${SCORE_FLUX_FORM})`,
  );
});
