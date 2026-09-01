// scoring/flux-formation — a formation Flux pays its figure.
//
// THE RULE. specs/scoring.md's first table: "A Flux in phase `formation`" pays
// `SCORE_FLUX_FORM` (`80`). This point decides that one figure.
//
// WHY THE FIGURE IS THE DISTINGUISHING VALUE. `80` is unlike every neighbouring
// figure in the table: a build that pays one figure per phase without regard to
// the kind reads `50` (the Shard's formation figure), one that ignores the phase
// and pays a Flux's diving figure reads `160`, and one that pays nothing reads
// `0`. Each wrong model lands on its own number, so the failure names it.
//
// THE FLUX IS HELD ON ITS BAND, AND THAT IS WHY THE SHOT LANDS. A Flux alternates
// between the bands on a telegraphed rhythm and "No shot destroys a shimmering
// Flux, of either band" (specs/drones.md). So the drone is posed with its band
// clock at `0` — the start of a window, well below `fluxHold(stage)` — and its
// oscillation gate OFF, which specs/instrumentation.md says holds "whichever band
// or shimmer it is in indefinitely". It is therefore holding cyan for the whole
// of the shot's flight, and the shot is the plain matching case specs/bands.md
// states. The rhythm itself is `drones`'s to grade, not this point's; here it is
// only kept out of the way, and the snapshot's own `shimmer` is read back before
// the shot so a build that shimmers anyway fails on that rather than on the
// figure.
//
// WHY A BYSTANDER STANDS IN THE CORNER. See `scene.ts`: it leaves a drone
// standing, so no `SCORE_STAGE_CLEAR` lands in the number this check reads.
//
// WHAT THIS DOES NOT DECIDE. That a matching shot destroys a held Flux is
// `bands`'s and `drones`'s; it is read here as the precondition of a payment.
// What a DIVING Flux pays is `scoring.flux-diving`.

import { afterEach, beforeEach, it } from "vitest";
import { SCORE_FLUX_FORM } from "../../src/constants";
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
 * Where the Flux is posed, in logical units.
 *
 * A clear stretch of the play field: below the formation grid's lowest row
 * (`332`) and its full sway, above the ship's lane (`SHIP_Y`, `600`), and well
 * clear of the corner the bystander holds.
 */
const TARGET_AT = { x: 900, y: 460 } as const;

/**
 * How far into its band window the Flux stands when the shot is fired.
 *
 * `0` is the start of a window, which specs/drones.md puts squarely in the held
 * part: the shimmer begins only at `fluxHold(stage)`, which is `FLUX_HOLD_L1`
 * (`1.6`) seconds at stage 1. With the oscillation gate off the clock does not
 * advance, so the Flux is holding its stored band throughout.
 */
const HELD_CLOCK = 0;

/** The band both the drone and the shot carry: a match by specs/bands.md. */
const MATCHING_BAND = "cyan" as const;

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
  const posed = requireDrone(before, target, "the Flux the shot destroys, as posed");
  assertEqual(
    posed.phase,
    "formation",
    "precondition: the Flux is in phase formation when the shot reaches it",
  );
  assertEqual(
    posed.shimmer,
    false,
    "precondition: the Flux is holding a band rather than shimmering " +
      "(specs/drones.md: no shot destroys a shimmering Flux)",
  );

  await shootDrone(h, target, MATCHING_BAND);

  // The score the kill left, on the frame the shot resolved.
  captureStill(h, "paid");

  const after = h.snapshot();
  assertUndefined(
    droneById(after, target),
    "precondition: the cyan shot destroyed the held cyan Flux (specs/bands.md)",
  );
  assertEqual(
    after.score,
    SCORE_FLUX_FORM,
    `the score after one Flux in phase formation was destroyed ` +
      `(specs/scoring.md: a Flux in phase formation pays SCORE_FLUX_FORM, ` +
      `${SCORE_FLUX_FORM})`,
  );
});
