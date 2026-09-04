// bands/inversion-cancels-two-swaps — two swaps cancel.
//
// specs/bands.md states effective band as ONE definition applied once per swap
// that holds — "its stored band, taken as the opposite band once for each of the
// following that holds" — and then says outright what that composition means:
// "The swaps compose as toggles rather than additively, so two of them cancel: a
// Prism whose stored band is cyan, whose shell has been broken, under an active
// inversion, reads cyan." specs/instrumentation.md repeats the same worked case
// for the snapshot.
//
// This is the item the two single-swap siblings cannot reach. A build that
// applies each swap correctly but composes them additively — say, one that reads
// the core's band and then inverts it by rewriting rather than toggling, or one
// that treats "inverted" as a separate flag layered over "core exposed" — passes
// `bands/prism-shell-flips-effective-band` and `bands/inversion-swaps-drone` and
// plays wrongly at exactly the moment the case is named for.
//
// Both halves the review item states are read, and the second is the one that
// costs a build its grade if the reading is cosmetic: the snapshot says cyan, AND
// a CYAN shot destroys the exposed core, so a build whose contact code composes
// the swaps differently from its snapshot fails here.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertUndefined } from "../assert";
import { FORM_CENTER_X, INVERSION_TIME } from "../constants";
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

/** Where the Prism stands: mid-field, clear of both HUD strips and of the ship. */
const AT = { x: FORM_CENTER_X, y: 300 } as const;

/**
 * How far below the Prism the shot is placed, in logical units.
 *
 * With only its core left a Prism's contact reach against one of the player's
 * bullets is `PRISM_CORE_HALF` (13) + `PLAYER_BULLET_HALF` (6) = 19 units of
 * centre separation, so 140 starts the bullet seven times clear of it.
 */
const SHOT_BELOW = 140;

/**
 * Frames the flight is allowed.
 *
 * At `PLAYER_BULLET_SPEED` (760), 7.6 units per frame of the harness's 100 Hz
 * clock: the core's 19-unit reach is entered 121 units up, inside 16 frames, and
 * 30 leaves slack for whichever frame a build resolves the contact on. The whole
 * flight costs the inversion 0.3 s of its 5.
 */
const SHOT_FRAMES = 30;

let harness: Harness;

beforeEach(async () => {
  harness = await createHarness();
});

afterEach(async () => {
  await harness.dispose();
});

it("reads a stored-cyan Prism with its shell broken under an inversion as cyan", async () => {
  await startPosed(harness);
  const id = await poseDrone(harness, "prism", AT.x, AT.y, {
    band: "cyan",
    shell: false,
  });
  await harness.debug.setInversion(INVERSION_TIME);
  // One frame, so the picture kept below is the posed field rather than the one
  // before it.
  await harness.advance(1);

  const posed = await harness.snapshot();
  assertEqual(
    posed.inversionActive,
    true,
    "an inversion running over the broken-shelled Prism",
  );
  const prism = requireDrone(posed, id, "the twice-swapped Prism");
  assertEqual(prism.shellAlive, false, "the broken shell the scenario posed");
  assertEqual(prism.band, "cyan", "the Prism's stored band");
  assertEqual(
    prism.effectiveBand,
    "cyan",
    "the band a stored-cyan Prism with its shell broken reads as under an inversion: two toggles cancel (specs/bands.md)",
  );

  const shot = await shootDrone(harness, id, "cyan", {
    below: SHOT_BELOW,
    maxFrames: SHOT_FRAMES,
  });
  await captureStill(harness, "cancelled");

  assertEqual(shot.hit, true, "the cyan shot resolving inside its flight");
  assertUndefined(
    droneById(shot.snapshot, id),
    "the exposed core a CYAN shot destroys while the two swaps cancel (specs/bands.md)",
  );
});
