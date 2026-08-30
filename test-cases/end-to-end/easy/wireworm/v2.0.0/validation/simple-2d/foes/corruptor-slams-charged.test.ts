// foes/corruptor-slams-charged — a slam goes straight to critical rather than up
// one.
//
// specs/foes.md: "A corruptor sets the node on the tile its center occupies to
// CHARGE_MAX (3), whatever charge that node held, so a node it crosses goes
// straight to critical rather than up one level."
//
// This is the edge foes/corruptor-slams cannot reach. A node posed at charge `1`
// separates the slam, which reads `3`, from the one-level bump specs/nodes.md
// gives the worm's blocked head, which reads `2`, and from a build that leaves
// an already-charged node alone, which never changes it at all. It has its own
// point so a failed grade names which of those a build implemented.
//
// What is graded is the FIRST change the corruptor made, for the reason
// foes/corruptor-slams gives: specs/foes.md fixes a foe's effect as an
// OCCUPANCY, so a build raising the charge by one acts again on every update it
// stands there and would reach CHARGE_MAX inside any window. The corruptor is
// posed with its locomotion held, so it acts on exactly the tile it was placed
// on.

import { afterEach, beforeEach, it } from "vitest";
import { CHARGE_MAX } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { poseStillFoe, untilTileChanges } from "./harness";

/** The tile the corruptor stands on: clear of the band and of the entry row. */
const TILE_C = 10;
const TILE_R = 4;

/** The charge the node is posed at: low, one step up from inert. */
const LOW = 1;

/**
 * How long the corruptor is given to act at all: the same quarter second
 * foes/corruptor-slams gives it, so the two readings are taken over the same
 * span of play. What is graded is the first change inside it.
 */
const ACT_SECONDS = 0.25;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("takes an already-charged node straight to critical", async () => {
  startPlaying(h);
  h.debug.setNode(TILE_C, TILE_R, LOW);
  poseStillFoe(h, "corruptor", TILE_C, TILE_R);

  const change = await untilTileChanges(
    h,
    TILE_C,
    TILE_R,
    ticksFor(ACT_SECONDS),
  );
  captureStill(h, "slammed");

  assertEqual(
    change.now,
    CHARGE_MAX,
    `the corruptor's first act on the charge-${LOW} node on (${TILE_C}, ` +
      `${TILE_R}) takes it to CHARGE_MAX (${CHARGE_MAX}) rather than to ` +
      `${LOW + 1}, one above`,
  );
});
