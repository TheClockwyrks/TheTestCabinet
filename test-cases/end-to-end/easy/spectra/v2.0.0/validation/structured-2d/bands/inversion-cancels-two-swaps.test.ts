// bands/inversion-cancels-two-swaps — two swaps cancel.
//
// specs/bands.md states effective band as ONE definition applied once per swap that
// holds — "its stored band, taken as the opposite band once for each of the
// following that holds" — and then says outright what that composition means: "The
// swaps compose as toggles rather than additively, so two of them cancel: a Prism
// whose stored band is cyan, whose shell has been broken, under an active
// inversion, reads cyan." specs/instrumentation.md repeats the same worked case for
// the snapshot.
//
// THIS IS THE POINT THE TWO SINGLE-SWAP SIBLINGS CANNOT REACH. A build that applies
// each swap correctly but composes them additively — one that reads the core's band
// and then inverts it by rewriting rather than toggling, or one that treats
// "inverted" as a separate flag layered over "core exposed" — passes
// `bands.prism-shell-flips-effective-band` and `bands.inversion-swaps-drone` and
// plays wrongly at exactly the moment the case is named for.
//
// BOTH HALVES THE REVIEW ITEM STATES ARE READ, and the second is what costs a build
// its grade if the reading is merely cosmetic: the snapshot says cyan, AND a CYAN
// shot destroys the exposed core. A build whose contact code composes the swaps
// differently from its snapshot fails here.
//
// THE PICTURE IS KEPT BEFORE THE SHOT, on the posed field. This scenario destroys
// the only drone on the field and specs/stages.md clears a stage "in the moment the
// last drone of its wave is destroyed", so the frame after the shot lands is the
// stage-cleared interstitial — and what the review item asks to see is the
// twice-swapped Prism reading its stored band, which is what stands here.

import { afterEach, beforeEach, it } from "vitest";
import {
  INVERSION_TIME,
  PLAYER_BULLET_HALF,
  PRISM_CORE_HALF,
} from "../constants";
import { assertEqual, assertUndefined, fail } from "../assert";
import {
  LANE_CENTER,
  captureStill,
  createHarness,
  droneById,
  fireAt,
  poseDrone,
  seconds,
  startPosed,
  type Harness,
} from "../harness";

/** Where the Prism stands: mid-field, clear of both HUD strips and of the ship. */
const AT_X = LANE_CENTER;
const AT_Y = 320;

/** The Prism's stored band, which two cancelling swaps must leave it reading. */
const STORED = "cyan" as const;

/**
 * The contact reach against one of the player's bullets, in logical units.
 *
 * With only its core left a Prism's contact half-extent is `PRISM_CORE_HALF`
 * (`13`, specs/drones.md), and a player bullet's is `PLAYER_BULLET_HALF` (`6`,
 * specs/ship.md); specs/simulation.md decides the contact as the overlap of the
 * two circles.
 */
const TOUCHING = PRISM_CORE_HALF + PLAYER_BULLET_HALF;

/** How far below the Prism the shot starts: seven times the contact reach. */
const SHOT_BELOW = 7 * TOUCHING;

/**
 * Frames the flight is allowed.
 *
 * At `PLAYER_BULLET_SPEED` (`760`) the core's reach is entered after
 * `SHOT_BELOW - TOUCHING` = 114 units, inside 16 frames of the harness's 100 Hz
 * clock, and 30 leaves slack for whichever sub-step a build resolves the contact
 * on. The whole flight costs the inversion {@link FLIGHT_COST} s of its 5.
 */
const FLIGHT_TICKS = 30;

/** What the flight costs the running inversion, in seconds. */
const FLIGHT_COST = seconds(FLIGHT_TICKS);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("reads a stored-cyan Prism with its shell broken under an inversion as cyan", async () => {
  startPosed(h);
  const id = poseDrone(h, "prism", AT_X, AT_Y, { band: STORED, shell: false });
  h.debug.setInversion(INVERSION_TIME);
  // One frame, so the picture kept below is the posed field rather than the one
  // before it. It costs the inversion 0.01 s of its 5.
  await h.advance(1);

  const posed = h.snapshot();
  captureStill(h, "cancelled");

  assertEqual(
    posed.inversionActive,
    true,
    "an inversion running over the broken-shelled Prism",
  );
  const prism = droneById(posed, id);
  if (prism === undefined) {
    fail(
      "the posed Prism still on the drone roster (specs/instrumentation.md)",
      "no drone carries the id addDrone appended",
    );
  }
  assertEqual(prism.shellAlive, false, "the broken shell the scenario posed");
  assertEqual(prism.band, STORED, "the Prism's stored band");
  assertEqual(
    prism.effectiveBand,
    STORED,
    `the band a stored-${STORED} Prism with its shell broken reads as under an ` +
      `inversion: its stored band, the two swaps composing as toggles that ` +
      `cancel (specs/bands.md)`,
  );

  await fireAt(h, AT_X, AT_Y, STORED, SHOT_BELOW, FLIGHT_TICKS);

  assertUndefined(
    droneById(h.snapshot(), id),
    `the exposed core a ${STORED} shot destroys while the two swaps cancel, ` +
      `after a flight costing ${FLIGHT_COST} s of INVERSION_TIME ` +
      `${INVERSION_TIME} (specs/bands.md)`,
  );
});
