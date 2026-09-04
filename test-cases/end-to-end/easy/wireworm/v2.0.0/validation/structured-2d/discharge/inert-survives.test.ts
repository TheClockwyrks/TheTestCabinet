// discharge/inert-survives — an inert node inside the blast stands.
//
// specs/discharge.md says it in one sentence: "A node at charge `0` is neither
// detonated nor removed by a discharge, and it does not conduct". Its charge is
// untouched too, because specs/nodes.md admits no other route: "Charge never
// changes on its own ... nothing raises or lowers it except the events below",
// and a discharge is not among them.
//
// The node posed here is a diagonal neighbor of the detonation, one tile away and
// so well inside the `5 x 5` block the chain arcs across — a build that swept the
// block without reading the charge cannot miss it. The reading separates each
// wrong model: a build that detonates what it reaches leaves the tile empty, a
// build that charges the block instead reports `1`, and a correct build reports
// the `0` it was posed at.
//
// That the inert node does not CONDUCT is the other half of the same sentence and
// is discharge/inert-blocks-reach, a point of its own.

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
const STRUCK = { c: 12, r: 8 };

/**
 * The inert node: a diagonal neighbor of the detonation, a Chebyshev distance of
 * `1`, so it is inside the `5 x 5` block by a clear margin.
 */
const INERT = { c: 13, r: 7 };

/** Charge `0` is inert, as specs/nodes.md's charge table states. */
const INERT_CHARGE = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves an inert node inside the blast standing at charge 0", async () => {
  startPlaying(h);
  h.debug.setNode(INERT.c, INERT.r, INERT_CHARGE);

  await detonate(h, STRUCK.c, STRUCK.r);

  captureStill(h, "survivor");
  const after = h.snapshot();
  assertNull(
    chargeAt(after, STRUCK.c, STRUCK.r),
    "precondition: the struck critical node detonated",
  );
  assertEqual(
    chargeAt(after, INERT.c, INERT.r),
    INERT_CHARGE,
    "the charge on the inert node's tile inside the blast",
  );
});
