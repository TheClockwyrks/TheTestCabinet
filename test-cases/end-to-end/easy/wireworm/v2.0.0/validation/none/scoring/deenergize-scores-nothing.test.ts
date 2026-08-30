// scoring/deenergize-scores-nothing — knocking a node's charge down pays nothing.
//
// `specs/scoring.md`, on what does not score: "A bolt that knocks a node's charge
// down one level pays nothing". `specs/nodes.md`'s bolt table is what makes this
// event a knock-down rather than a removal or a detonation: a bolt into a charge
// `2` node leaves the node "standing at charge `1`".
//
// CHARGE `2` IS THE DISTINGUISHING VALUE. It is the one charge that is neither
// the inert node a bolt removes (charge `0`, which pays `SCORE_INERT_NODE`) nor
// the critical node a bolt detonates (charge `3`, whose discharge pays
// `SCORE_PURGE_NODE` for every node it clears), so a build that has collapsed the
// bolt table into one outcome reads a figure rather than nothing, and which
// figure it reads names the outcome it collapsed to.
//
// THE SHOT IS PROVED TO HAVE LANDED. This is the one point in the directory whose
// figure is zero, and a score that did not move is exactly what a bolt that never
// resolved at all would also leave behind — so the bolt is driven through a window
// closed while its centre is still inside the node's tile — the flight window
// `scoring/payment.ts` fixes — and it having left flight inside that window is
// asserted first. Only a bolt that
// resolved can be gone by then, and the board holds nothing else for it to have
// resolved against.
//
// The board holds one node and nothing else: no worm and no foe, so no other
// figure can enter the reading.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual, assertUndefined } from "../assert";
import {
  boltById,
  captureStill,
  createHarness,
  startPlaying,
  type Harness,
} from "../harness";
import { shootInto } from "./payment";

/** The tile the node stands on. */
const NODE = { c: 14, r: 8 };

/** Charged: the charge a bolt leaves standing, one level down (`specs/nodes.md`). */
const CHARGED = 2;

/**
 * What the shot must pay, to the point: nothing at all.
 *
 * There is no tolerance on it and there cannot be one: a score is a whole number
 * of points and `specs/scoring.md` fixes the figure exactly, so the assertion is
 * equality.
 */
const EXPECTED = 0;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("pays nothing for a bolt that knocks a charged node down", async () => {
  await startPlaying(h);
  await h.debug.setNode(NODE.c, NODE.r, CHARGED);

  const before = (await h.snapshot()).score;
  const bolt = await shootInto(h, NODE.c, NODE.r);

  await captureStill(h, "unchanged");
  const after = await h.snapshot();
  assertUndefined(
    boltById(after, bolt),
    "precondition: the bolt resolved against the charged node",
  );
  assertEqual(
    after.score - before,
    EXPECTED,
    "the points a bolt into a charge-2 node paid",
  );
});
