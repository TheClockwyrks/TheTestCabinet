// discharge/chain-propagates — the chain runs onward from each node it detonates.
//
// specs/discharge.md, step 3: "Each node the chain detonates arcs onward the same
// way, so the discharge floods through the connected cluster of charged nodes
// until no charged node stands within reach of any node it detonated."
//
// The line posed here is exactly that claim and nothing else. Four charged nodes
// stand two columns apart along one row, with the critical node at the near end,
// so every node is within `DISCHARGE_RADIUS` (`2`) of its neighbor and NONE is
// within `2` of anything further along: the second node is four tiles from the
// detonation, the third six, the fourth eight. Only a chain that runs onward from
// each node it detonates clears the line.
//
// That separates the wrong models by how far the line is cleared. A build that
// arcs once from the struck node and stops leaves three nodes standing at charge
// `1`; a build that stops one wave later leaves two; a build that de-energizes
// rather than detonates leaves a line of `0`s. Only the stated rule empties every
// tile.

import { afterEach, beforeEach, it } from "vitest";
import { ARC_LIFE } from "../constants";
import { assertNull } from "../assert";
import {
  captureReplay,
  chargeAt,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
  type WirewormSnapshot,
} from "../harness";
import { detonate } from "./detonation";

/** The critical node at the near end of the line. */
const STRUCK = { c: 8, r: 8 };

/**
 * The charged nodes the chain has to walk, each two columns past the one before
 * it, so each is exactly `DISCHARGE_RADIUS` (`2`) from its neighbor and four or
 * more from every other node of the line.
 */
const LINE = [
  { c: 10, r: 8 },
  { c: 12, r: 8 },
  { c: 14, r: 8 },
  { c: 16, r: 8 },
];

/** The charge each node of the line is posed at: the lowest the chain conducts to. */
const LINE_CHARGE = 1;

/**
 * Frames recorded after the chain resolves, so the clip carries the arcs for the
 * whole of their `ARC_LIFE` (`0.32` s) rather than cutting at the detonation.
 */
const SETTLE_TICKS = ticksFor(ARC_LIFE);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("clears a line of charged nodes end to end from one detonation", async () => {
  startPlaying(h);
  for (const node of LINE) h.debug.setNode(node.c, node.r, LINE_CHARGE);

  const after = await captureReplay(h, "propagation", async () => {
    await detonate(h, STRUCK.c, STRUCK.r);
    const resolved: WirewormSnapshot = h.snapshot();
    await h.advance(SETTLE_TICKS);
    return resolved;
  });

  assertNull(
    chargeAt(after, STRUCK.c, STRUCK.r),
    "precondition: the struck critical node detonated",
  );
  for (const node of LINE) {
    assertNull(
      chargeAt(after, node.c, node.r),
      `the charge on the tile at column ${node.c}`,
    );
  }
});
