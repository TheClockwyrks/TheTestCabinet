// discharge/inert-blocks-reach — an inert node does not carry the chain.
//
// specs/discharge.md: a charge `0` node "does not conduct: the chain leaps over
// it, and a charged node reachable only through an inert node is reached only if
// it lies within `DISCHARGE_RADIUS` of a node the chain detonated by another
// route."
//
// The row posed here is that sentence laid out on the board. The critical node is
// struck; an inert node stands two tiles along it; a charged node stands two tiles
// past the inert one. The charged node is four tiles from the detonation and so
// out of reach of the only node the chain can detonate, and the only path to it
// runs through the inert node the spec says does not conduct. It therefore stands,
// at exactly the charge it was posed at.
//
// It is posed at charge `2` rather than `1` so every wrong model reads as its own
// number: a build whose inert nodes conduct detonates it and the tile answers
// empty, a build that de-energizes what a chain reaches answers `1`, a build that
// charges what it reaches answers `3`, and a correct build answers `2`.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertNull } from "../assert";
import {
  captureStill,
  chargeAt,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { detonate } from "./detonation";

/** The critical node the bolt is fired into. */
const STRUCK = { c: 10, r: 8 };

/**
 * The inert node the chain would have to conduct through: two tiles from the
 * detonation, so it is inside the blast, and two tiles from the shielded node.
 */
const INERT = { c: 12, r: 8 };

/**
 * The charged node the inert one shields: four tiles from the detonation — the
 * only node the chain can detonate — and so more than `DISCHARGE_RADIUS` (`2`)
 * from every detonated node by any route but the inert one.
 */
const SHIELDED = { c: 14, r: 8 };

/** The charge it is posed at, and the charge it must still report. */
const SHIELDED_CHARGE = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves a charged node reachable only through an inert node at its charge", async () => {
  startPlaying(h);
  h.debug.setNode(INERT.c, INERT.r, 0);
  h.debug.setNode(SHIELDED.c, SHIELDED.r, SHIELDED_CHARGE);

  await detonate(h, STRUCK.c, STRUCK.r);

  captureStill(h, "blocked");
  const after = h.snapshot();
  assertNull(
    chargeAt(after, STRUCK.c, STRUCK.r),
    "precondition: the struck critical node detonated",
  );
  assertEqual(
    chargeAt(after, SHIELDED.c, SHIELDED.r),
    SHIELDED_CHARGE,
    "the charge on the node the inert one shielded",
  );
});
