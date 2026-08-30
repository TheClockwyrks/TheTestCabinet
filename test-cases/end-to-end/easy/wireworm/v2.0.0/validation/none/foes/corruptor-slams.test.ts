// foes/corruptor-slams — a corruptor slams the node it is standing on to
// critical.
//
// `specs/foes.md`: "A corruptor sets the node on the tile its center occupies to
// CHARGE_MAX (3), whatever charge that node held."
//
// The node is posed INERT, at charge `0`, which is the farthest a node can be
// from critical, and what is graded is the FIRST change the corruptor made to
// it. A slam reads `3`; the one-level bump `specs/nodes.md` gives a worm's
// blocked head reads `1`; a tile the corruptor never touched never changes at
// all. Reading the first change rather than the tile at the end of a window is
// what keeps those apart — `specs/foes.md` fixes a foe's effect as an OCCUPANCY,
// so a build raising the charge by one acts again on every update it stands
// there and would reach `CHARGE_MAX` within a few frames of any window.
//
// The corruptor is posed with its locomotion held, so it acts on exactly the
// tile it was placed on and no other node in the scenario is touched. Its mind
// is left on, because the slam IS the mind and the slam is what this point is
// about.

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

/** The charge the node is posed at: inert, the bottom of `specs/nodes.md`'s ramp. */
const INERT = 0;

/**
 * How long the corruptor is given to act at all, in seconds.
 *
 * `specs/foes.md` fixes no cadence for a foe's effect, so this is a bound rather
 * than a figure derived from one: a quarter second is every chance a build needs
 * to act on the single tile it is standing on. What is graded is the first
 * change inside it, so this decides nothing but how long a build that never acts
 * is waited for.
 */
const ACT_SECONDS = 0.25;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("takes the inert node the corruptor stands on to critical", async () => {
  await startPlaying(h);
  await h.debug.setNode(TILE_C, TILE_R, INERT);
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
    `the corruptor's first act on the node on (${TILE_C}, ${TILE_R}) takes ` +
      `it from ${INERT} to CHARGE_MAX (${CHARGE_MAX})`,
  );
});
