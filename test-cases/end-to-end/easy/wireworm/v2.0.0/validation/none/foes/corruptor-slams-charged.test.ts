// foes/corruptor-slams-charged — a slam goes straight to critical rather than up
// one.
//
// `specs/foes.md`: "A corruptor sets the node on the tile its center occupies to
// CHARGE_MAX (3), whatever charge that node held, so a node it crosses goes
// straight to critical rather than up one level."
//
// THIS IS THE EDGE foes/corruptor-slams CANNOT REACH, and it is its own point so
// that a failed grade names which model a build wrote. From an inert node a slam
// and a bump-per-update are told apart only by which frame they arrive on; from
// a node posed at charge `1` they are told apart by the NUMBER: a slam reads
// `3`, the one-level bump `specs/nodes.md` gives a worm's blocked head reads
// `2`, and a build that leaves an already-charged node alone never changes it at
// all.
//
// What is graded is the FIRST change, for the reason foes/corruptor-slams gives:
// `specs/foes.md` fixes a foe's effect as an OCCUPANCY, so a build raising the
// charge by one acts again on every update it stands there and would reach
// `CHARGE_MAX` inside any window. The corruptor is posed with its locomotion
// held, so it acts on exactly the tile it was placed on.

import { afterEach, beforeEach, it } from "vitest";
import { CHARGE_MAX } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  createHarness,
  framesFor,
  poseFoe,
  startPlaying,
  type Harness,
} from "../harness";
import { untilTileChanges } from "./watching";

/** The tile the corruptor stands on: one of the rows a corruptor enters on. */
const TILE_C = 10;
const TILE_R = 4;

/** The charge the node is posed at: low, one step up from inert. */
const LOW = 1;

/**
 * How long the corruptor is given to act at all, in seconds: the same quarter
 * second foes/corruptor-slams gives it, so the two readings are taken over the
 * same span of play. What is graded is the first change inside it.
 */
const ACT_SECONDS = 0.25;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("takes an already-charged node straight to critical", async () => {
  await startPlaying(h);
  await h.debug.setNode(TILE_C, TILE_R, LOW);
  await poseFoe(h, "corruptor", TILE_C, TILE_R, { travel: false });

  const change = await untilTileChanges(
    h,
    TILE_C,
    TILE_R,
    framesFor(ACT_SECONDS),
  );

  await captureStill(h, "slammed");
  assertEqual(
    change.now,
    CHARGE_MAX,
    `the corruptor's first act on the charge-${LOW} node on (${TILE_C}, ` +
      `${TILE_R}) takes it to CHARGE_MAX (${CHARGE_MAX}) rather than to ` +
      `${LOW + 1}, one above`,
  );
});
