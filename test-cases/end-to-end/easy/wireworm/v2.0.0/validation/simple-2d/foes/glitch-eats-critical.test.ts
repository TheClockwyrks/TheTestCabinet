// foes/glitch-eats-critical — a glitch removes a critical node without
// detonating it.
//
// specs/foes.md: "A glitch removes the node on the tile its center occupies,
// whatever that node's charge. A critical node eaten this way is removed without
// detonating, so no discharge fires and no arc is reported."
//
// The two clauses are one scenario read twice rather than two requirements:
// eating and detonating leave the eaten tile in the same state, so the check
// poses a WITNESS that tells them apart. specs/discharge.md fixes a detonation
// as arcing to every charged node within DISCHARGE_RADIUS (2) tiles, each of
// which is itself detonated and removed, so a charged node two tiles away
// survives an eating and would not survive a discharge. The witness is posed at
// charge `2`, the one value from which "untouched", "de-energized" and
// "detonated" all read as different numbers.
//
// The board is read at the FIRST frame the eaten tile changes, for two reasons:
// a build that de-energizes a critical node one step at a time is named by the
// `2` its first act leaves rather than by the empty tile three frames later, and
// the arcs a discharge would have reported are still alive at that frame,
// whatever ARC_LIFE a build gives them.
//
// The glitch is posed with its locomotion held, so it acts on exactly the tile
// it was placed on (specs/foes.md) and nothing in the scenario moves.

import { afterEach, beforeEach, it } from "vitest";
import { CHARGE_MAX, DISCHARGE_RADIUS } from "../constants";
import { assertEqual, assertLength, assertNull } from "../assert";
import {
  captureStill,
  chargeAt,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { poseStillFoe, untilTileChanges } from "./harness";

/** The tile the glitch stands on, and the critical node it is standing on. */
const TILE_C = 10;
const TILE_R = 8;

/** The witness: charged, and inside the radius a detonation would reach. */
const WITNESS_C = TILE_C + DISCHARGE_RADIUS;
const WITNESS_R = TILE_R;
const WITNESS_CHARGE = 2;

/**
 * How long the glitch is given to act at all.
 *
 * specs/foes.md fixes no cadence for a foe's effect, so this is a bound rather
 * than a figure: a quarter second, thirty frames of the suite's clock, is every
 * chance a build needs to act on the one tile it is standing on. What is graded
 * is the first change inside it.
 */
const ACT_SECONDS = 0.25;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("removes a critical node without firing a discharge", async () => {
  startPlaying(h);
  h.debug.setNode(TILE_C, TILE_R, CHARGE_MAX);
  h.debug.setNode(WITNESS_C, WITNESS_R, WITNESS_CHARGE);
  poseStillFoe(h, "glitch", TILE_C, TILE_R);

  const change = await untilTileChanges(
    h,
    TILE_C,
    TILE_R,
    ticksFor(ACT_SECONDS),
  );
  captureStill(h, "eaten");

  assertNull(
    change.now,
    `the glitch's first act on the critical node on (${TILE_C}, ${TILE_R}) ` +
      `removes it, leaving that tile empty`,
  );
  assertLength(
    change.snapshot.arcs,
    0,
    "no discharge fired on the frame the node went, so no arc is reported",
  );
  assertEqual(
    chargeAt(change.snapshot, WITNESS_C, WITNESS_R),
    WITNESS_CHARGE,
    `the charge-${WITNESS_CHARGE} node ${DISCHARGE_RADIUS} tiles away is ` +
      `untouched, so no chain reached it`,
  );
});
