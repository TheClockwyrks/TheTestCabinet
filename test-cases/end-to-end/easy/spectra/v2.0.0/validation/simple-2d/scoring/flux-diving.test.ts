// scoring/flux-diving — a diving Flux pays its figure.
//
// THE RULE. specs/scoring.md's first table: "A Flux in phase `entering`,
// `diving`, or `returning`" pays `SCORE_FLUX_DIVE` (`160`). This point decides
// that figure for the phase the rule is named after, `diving`.
//
// WHY THE FIGURE IS THE DISTINGUISHING VALUE. `160` is twice the `80` a formation
// Flux pays, so a build that ignores the phase reads `80` here; a build that
// ignores the KIND and pays a Shard's diving figure reads `100`; a build that pays
// nothing reads `0`. Each wrong model lands on its own number.
//
// THE FLUX IS HELD ON ITS BAND, AND DIVING, AND DOING NOTHING ELSE. "No shot
// destroys a shimmering Flux, of either band" (specs/drones.md), so the band clock
// is posed at `0` — the start of a window, below `fluxHold(stage)` — and the
// oscillation gate is off, which holds it there. The travel gate is off too, so the
// drone holds its exact centre and keeps its phase (specs/instrumentation.md), and
// the fire gate is off so no bullet a dive carries enters a scenario that is about
// a number. What a dive's path and its fire do belongs to `swarm`'s and `drones`'s
// items.
//
// WHAT THIS DOES NOT DECIDE. That a matching shot destroys a held Flux is
// `bands`'s and `drones`'s. What a FORMATION Flux pays is `scoring/flux-formation`.

import { afterEach, beforeEach, it } from "vitest";
import { FLUX_HALF, PLAYER_BULLET_HALF, SCORE_FLUX_DIVE } from "../constants";
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

/**
 * Where the Flux is posed, in logical units.
 *
 * A clear stretch of the play field: below the formation grid's lowest row
 * (`slotY(4)`, `332`) and its full sway, above the ship's lane (`SHIP_Y`,
 * `600`).
 */
const TARGET_AT = { x: 900, y: 460 } as const;

/** The band the Flux holds and the shot carries: a match by specs/bands.md. */
const MATCHING_BAND = "cyan" as const;

/**
 * How far into its band window the Flux stands when the shot is fired.
 *
 * `0` is the start of a window, which specs/drones.md puts squarely in the HELD
 * part: the shimmer begins only at `fluxHold(stage)`, `FLUX_HOLD_L1` (`1.6`)
 * seconds at stage 1. With the oscillation gate off the clock does not advance.
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

it("adds exactly SCORE_FLUX_DIVE when a diving Flux is destroyed", async () => {
  startPosed(h);
  const target = poseDrone(h, "flux", TARGET_AT.x, TARGET_AT.y, {
    band: MATCHING_BAND,
    phase: "diving",
    bandClock: HELD_CLOCK,
  });

  const before = h.snapshot();
  assertEqual(before.score, 0, "precondition: the run opens with a score of 0");
  const posed = droneOf(before, target);
  assertEqual(
    posed.phase,
    "diving",
    "precondition: the Flux is in phase diving when the shot reaches it",
  );
  assertEqual(
    posed.shimmer,
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
    SCORE_FLUX_DIVE,
    "the score after one Flux in phase diving was destroyed " +
      "(specs/scoring.md: a Flux in phase entering, diving, or returning pays " +
      `SCORE_FLUX_DIVE, ${SCORE_FLUX_DIVE})`,
  );
});
