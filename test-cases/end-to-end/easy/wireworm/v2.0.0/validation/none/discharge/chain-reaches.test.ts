// discharge/chain-reaches — the arc reaches a charged node two tiles away.
//
// `specs/discharge.md`, step 2: a node that detonates "arcs to every node at
// charge `1` or above that is standing at that moment and whose tile lies within
// `DISCHARGE_RADIUS` (`2`) tiles of the detonating node's tile, measured as a
// Chebyshev distance: the `5 x 5` block of tiles centered on the detonating
// node. Each of those nodes is itself detonated."
//
// The node posed here sits on the corner of that block — two tiles across and
// two tiles up, so its Chebyshev distance is exactly `2` while its Euclidean
// distance is `2.83` and its Manhattan distance is `4`. That is the reading that
// tells the stated metric from the two a build might reach for instead: on a
// build measuring either of those the corner is out of range and the node stands
// at charge `1`, and on a build that lowers a charge instead of detonating it the
// node reports `0`. Only a Chebyshev build that detonates leaves the tile empty.
//
// The far side of this same boundary — a node three tiles out — is
// discharge/chain-stops, its own point, because a build that detonates the whole
// board and a build that detonates nothing would score alike on one paired item.

import { afterEach, beforeEach, it } from "vitest";
import { assertNull } from "../assert";
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
 * The charged node the chain has to reach: two columns across and two rows up,
 * so its Chebyshev distance from the detonation is exactly `DISCHARGE_RADIUS`
 * (`2`), on the diagonal corner of the `5 x 5` block.
 */
const REACHED = { c: 14, r: 6 };

/** The charge it is posed at: `1` is the lowest charge the chain conducts to. */
const REACHED_CHARGE = 1;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("detonates a charged node on the diagonal corner of the blast", async () => {
  await startPlaying(h);
  await h.debug.setNode(REACHED.c, REACHED.r, REACHED_CHARGE);

  await detonate(h, STRUCK.c, STRUCK.r);

  await captureStill(h, "reached");
  const after = await h.snapshot();
  assertNull(
    chargeAt(after, STRUCK.c, STRUCK.r),
    "precondition: the struck critical node detonated",
  );
  assertNull(
    chargeAt(after, REACHED.c, REACHED.r),
    "the charge on the tile two tiles out on the diagonal",
  );
});
