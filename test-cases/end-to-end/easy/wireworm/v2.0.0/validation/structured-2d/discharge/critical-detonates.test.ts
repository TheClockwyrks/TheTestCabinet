// discharge/critical-detonates — a bolt into a critical node detonates it.
//
// specs/nodes.md's bolt table gives charge `3` its own row: the node "detonates,
// as specs/discharge.md states", and every other charge is knocked down a level
// or cleared instead. specs/discharge.md's chain then opens with what a
// detonation is: "The struck node detonates. A detonated node is removed from the
// board, and its tile is left empty."
//
// So the reading is the tile itself, and it separates every wrong model by the
// number it answers with. A build that treated charge `3` like charge `2` — the
// row above it — leaves a node standing and reports `2`; one that ran the knock-
// down twice reports `1`; one that detonated correctly reports no node at all.
//
// Nothing else is on the board: one node, one bolt. What the detonation goes on
// to do to a cluster around it is the chain points next door.

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

/** The tile the critical node is posed on, clear of the entry row and the band. */
const STRUCK = { c: 12, r: 8 };

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("removes the struck critical node from the board", async () => {
  startPlaying(h);

  await detonate(h, STRUCK.c, STRUCK.r);

  captureStill(h, "detonated");
  assertNull(
    chargeAt(h.snapshot(), STRUCK.c, STRUCK.r),
    "the charge on the tile the critical node stood on",
  );
});
