// bands/inversion-cancels-two-swaps — two swaps cancel.
//
// specs/bands.md, "Effective band": a thing's effective band is "its stored band,
// taken as the opposite band once for each of the following that holds", and the
// file then states the composition outright — "The swaps compose as toggles
// rather than additively, so two of them cancel: a Prism whose stored band is
// cyan, whose shell has been broken, under an active inversion, reads cyan."
//
// THIS IS THE POINT NEITHER SWAP ALONE CAN REACH.
// `bands.prism-shell-flips-effective-band` grades the shell's toggle and
// `bands.inversion-swaps-drone` grades the inversion's; a build that applies the
// two ADDITIVELY — a Prism under an inversion reading "twice swapped" as
// something other than its stored band, or the second swap simply overriding the
// first — passes both of those and plays wrongly at exactly the moment the case
// is named for. So this file poses BOTH toggles at once and reads the
// composition.
//
// IT IS READ TWICE, in two ways that fail differently. First the reported
// `effectiveBand`, which is the definition itself; then the OUTCOME that
// definition decides — a cyan shot into the twice-swapped Prism destroys its
// exposed core — because a build may report one composition and match on another,
// and the case is played on the second.
//
// THE SHOT IS CYAN AND THE PLAYER'S. specs/bands.md never swaps the player's
// bullets, so under the same inversion the bullet still reads `cyan`, the Prism
// reads `cyan`, and the two effective bands match. The core is the exposed layer,
// so specs/drones.md destroys the Prism outright rather than taking a layer off
// it.
//
// THE STILL IS KEPT BEFORE THE SHOT, while the Prism is standing with its shell
// broken under the inversion, because that standing Prism is what the output
// names.

import { afterEach, beforeEach, it } from "vitest";
import {
  INVERSION_TIME,
  PLAYER_BULLET_SPEED,
  PRISM_CORE_HALF,
} from "../constants";
import { assertEqual, assertNull } from "../assert";
import {
  LANE_CENTER,
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

/** Where the Prism stands: well inside the play field (specs/field.md). */
const PRISM_X = LANE_CENTER;
const PRISM_Y = 320;

/** The band the shell stores, which two toggles must leave the Prism reading. */
const STORED_BAND = "cyan" as const;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves a broken-shell Prism reading its stored band under an inversion", async () => {
  startPosed(h);
  h.debug.setInversion(INVERSION_TIME);
  const prismId = poseDrone(h, "prism", PRISM_X, PRISM_Y, {
    band: STORED_BAND,
    shell: false,
  });

  await h.advance(1);
  captureStill(h, "cancelled");

  const posed = h.snapshot();
  assertEqual(
    posed.inversionActive,
    true,
    `an inversion running over the broken-shelled Prism after setInversion ` +
      `(${INVERSION_TIME} s) — with only one swap in play there would be ` +
      "nothing for the second to cancel",
  );

  const prism = droneOf(posed, prismId);
  assertEqual(
    prism.shellAlive,
    false,
    "the broken shell the scenario posed, which is the second of the two " +
      "swaps (specs/instrumentation.md)",
  );
  assertEqual(
    prism.band,
    STORED_BAND,
    "the Prism's stored band, which neither the fallen shell nor the " +
      "inversion changes (specs/bands.md)",
  );
  assertEqual(
    prism.effectiveBand,
    STORED_BAND,
    `the effective band of a Prism storing ${STORED_BAND} whose shell has ` +
      `been broken, with an inversion of ${INVERSION_TIME} s posed — ` +
      "specs/bands.md: the swaps compose as toggles rather than additively, " +
      "so two of them cancel",
  );

  await fireAt(h, PRISM_X, PRISM_Y, STORED_BAND);

  assertNull(
    findDrone(h.snapshot(), prismId),
    `the twice-swapped Prism is gone from the roster after one ` +
      `${STORED_BAND} bullet climbed ${SHOT_GAP} units at ` +
      `PLAYER_BULLET_SPEED ${PLAYER_BULLET_SPEED} into the ` +
      `${PRISM_CORE_HALF}-unit contact circle of its exposed core — ` +
      "specs/bands.md: a player bullet is never swapped, so a cyan shot " +
      "matches the cyan the twice-swapped Prism reads, and specs/drones.md " +
      "destroys a Prism whose exposed core falls",
  );
});
