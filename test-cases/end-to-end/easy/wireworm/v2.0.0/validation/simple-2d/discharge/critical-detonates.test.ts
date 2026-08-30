// discharge/critical-detonates — a bolt into a critical node detonates it.
//
// specs/nodes.md fixes what a bolt does to a node by the charge it struck, and
// charge `3` is the one row of that table that is not a knock-down: "The node
// detonates, as `specs/discharge.md` states". specs/discharge.md then opens the
// chain with what a detonation is — "The struck node detonates. A detonated node
// is removed from the board, and its tile is left empty."
//
// THE WORLD IS ONE NODE AND ONE BOLT. `startPlaying` leaves the board empty and
// the three world gates shut, and the scenario puts back exactly the two things
// the rule names: the critical node, and a bolt in the column below it. There is
// no worm, no foe and nothing else on the board, so the only thing that can have
// emptied the tile is the strike.
//
// THE POSED CHARGE IS THE DISTINGUISHING VALUE, and `CHARGE_MAX` is the value the
// item names. Every wrong model of a bolt into a critical node reads as its own
// number here: a detonation leaves the tile EMPTY, a build that knocked the
// charge down one leaves `2`, a build that cleared it to inert leaves `0`, and a
// build whose bolt did nothing at all leaves `3`. So the failure names the model.
//
// WHAT THIS DOES NOT DECIDE. Where the chain goes from here is `chain-reaches`
// and `chain-stops`, and the links it reports are `arcs-reported`; this point
// reads the struck tile alone.

import { afterEach, beforeEach, it } from "vitest";
import { BOARD_H, BOLT_SPEED, CHARGE_MAX } from "../../src/constants";
import { assertNull, assertTrue } from "../assert";
import {
  captureStill,
  chargeAt,
  createHarness,
  poseBolt,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** The tile the critical node stands on: clear of every edge and of the band. */
const STRUCK_C = 12;
const STRUCK_R = 6;

/**
 * The most frames the bolt is given to resolve.
 *
 * specs/cursor.md flies a bolt straight up at `BOLT_SPEED` (`900` units per
 * second), so a bolt posed one tile below its target needs half a tile of climb
 * — `0.018` s. The ceiling here is the whole board's height at that speed
 * (`640 / 900`, so `86` frames of the 120 Hz clock), which is far past what the
 * strike needs and still bounded: a bolt that has not resolved by then has left
 * the board, and the sweep's own guard says so rather than the reading going
 * quietly vacuous.
 */
const BOLT_SWEEP_TICKS = ticksFor(BOARD_H / BOLT_SPEED);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("removes a critical node from the board when a bolt strikes it", async () => {
  startPlaying(h);
  h.debug.setNode(STRUCK_C, STRUCK_R, CHARGE_MAX);
  poseBolt(h, STRUCK_C, STRUCK_R + 1);

  const swept = await h.until((s) => s.bolts.length === 0, {
    maxFrames: BOLT_SWEEP_TICKS,
  });
  captureStill(h, "detonated");

  // The scenario's own precondition: the bolt reached something and left flight.
  // What it DID is the reading below.
  assertTrue(
    swept.hit,
    "the bolt to resolve and leave flight within the sweep (specs/cursor.md)",
  );
  assertNull(
    chargeAt(swept.snapshot, STRUCK_C, STRUCK_R),
    `the node on the struck tile (${STRUCK_C}, ${STRUCK_R}) after the bolt: a ` +
      "detonated node is removed and its tile left empty",
  );
});
