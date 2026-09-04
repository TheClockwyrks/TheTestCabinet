// discharge/inert-survives — an inert node inside the blast stands.
//
// specs/discharge.md: "A node at charge `0` is neither detonated nor removed by a
// discharge, and it does not conduct". The chain arcs only to nodes "at charge
// `1` or above", so an inert node inside the `5 x 5` block is passed over.
//
// THE INERT NODE IS DEEP INSIDE THE BLOCK, one tile from the detonation on the
// diagonal, so nothing about its position could put it out of reach: the only
// thing that spares it is its charge. A build that clears the whole `5 x 5` block
// regardless of charge leaves its tile EMPTY and is named here.
//
// THE READING IS THE CHARGE AND NOT MERE PRESENCE, so a build that spared the
// node but energized it on the way past reads `1` rather than the `0` it was
// posed at, and one that de-energized something reads `null`. Every wrong model
// gets its own number.
//
// THE DISCHARGE IS GUARDED. A reading that "the inert node still stands" means
// nothing unless a discharge actually fired, so the struck tile is read first as
// the scenario's precondition. Whether a bolt into a critical node detonates it
// is `critical-detonates`'s requirement and is graded there.
//
// WHAT THIS DOES NOT DECIDE. That the inert node also refuses to CARRY the chain
// onward is `inert-blocks-reach`'s requirement, and it needs a third node to
// read; this point poses two and reads the inert one's own survival.

import { afterEach, beforeEach, it } from "vitest";
import { BOARD_H, BOLT_SPEED, CHARGE_MAX } from "../constants";
import { assertEqual, assertNull, assertTrue } from "../assert";
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

/** One tile off the detonation on the diagonal: deep inside the `5 x 5` block. */
const INERT_C = STRUCK_C + 1;
const INERT_R = STRUCK_R + 1;

/** Inert: the one charge specs/nodes.md calls a node that does not conduct. */
const INERT_CHARGE = 0;

/**
 * The most frames the bolt is given to resolve.
 *
 * specs/cursor.md flies a bolt straight up at `BOLT_SPEED` (`900` units per
 * second), so a bolt posed one tile below its target needs half a tile of climb.
 * The ceiling is the whole board's height at that speed (`640 / 900`), far past
 * what the strike needs and still bounded.
 */
const BOLT_SWEEP_TICKS = ticksFor(BOARD_H / BOLT_SPEED);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves an inert node inside the blast standing at charge 0", async () => {
  startPlaying(h);
  h.debug.setNode(STRUCK_C, STRUCK_R, CHARGE_MAX);
  h.debug.setNode(INERT_C, INERT_R, INERT_CHARGE);
  poseBolt(h, STRUCK_C, STRUCK_R + 1);

  const swept = await h.until((s) => s.bolts.length === 0, {
    maxFrames: BOLT_SWEEP_TICKS,
  });
  captureStill(h, "survivor");

  assertTrue(
    swept.hit,
    "the bolt to resolve and leave flight within the sweep (specs/cursor.md)",
  );
  assertNull(
    chargeAt(swept.snapshot, STRUCK_C, STRUCK_R),
    "the struck tile to be empty, which is the scenario's precondition: a " +
      "discharge has to have fired for the blast to be read at all " +
      "(graded by discharge.critical-detonates)",
  );

  assertEqual(
    chargeAt(swept.snapshot, INERT_C, INERT_R),
    INERT_CHARGE,
    `the charge on the inert node at (${INERT_C}, ${INERT_R}), one tile from ` +
      "the detonation and inside its 5 x 5 block",
  );
});
