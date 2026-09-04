// discharge/chain-stops — a charged node beyond the reach survives.
//
// `specs/discharge.md`, step 2, bounds the chain: a detonating node arcs to every
// charged node "whose tile lies within `DISCHARGE_RADIUS` (`2`) tiles ...
// measured as a Chebyshev distance". A node further out than that is not arced
// to, and `specs/nodes.md` is explicit that nothing else moves a charge: "Charge
// never changes on its own. It does not decay, it does not rise with time, and
// nothing raises or lowers it except the events below."
//
// So the node posed three columns from the detonation, with the two tiles between
// them empty, is untouched: it still stands and it still holds the charge it was
// posed at. The reading names each wrong model with a different number. A build
// whose radius is `3` detonates it and the tile answers empty; a build that
// de-energizes what it reaches instead of detonating it answers `0`; a correct
// build answers `1`.
//
// The near side of the same boundary is discharge/chain-reaches, its own point.

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
 * The charged node the chain must not reach: three columns along the same row, a
 * Chebyshev distance of `3`, one past `DISCHARGE_RADIUS` (`2`).
 *
 * The two tiles between it and the detonation are left empty, so there is no
 * charged node to carry the chain to it by another route.
 */
const SURVIVOR = { c: 15, r: 8 };

/** The charge it is posed at, and the charge it must still report. */
const SURVIVOR_CHARGE = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("leaves a charged node three tiles out standing at its charge", async () => {
  await startPlaying(h);
  await h.debug.setNode(SURVIVOR.c, SURVIVOR.r, SURVIVOR_CHARGE);

  await detonate(h, STRUCK.c, STRUCK.r);

  await captureStill(h, "survivor");
  const after = await h.snapshot();
  assertNull(
    chargeAt(after, STRUCK.c, STRUCK.r),
    "precondition: the struck critical node detonated",
  );
  assertEqual(
    chargeAt(after, SURVIVOR.c, SURVIVOR.r),
    SURVIVOR_CHARGE,
    "the charge on the tile three tiles out",
  );
});
