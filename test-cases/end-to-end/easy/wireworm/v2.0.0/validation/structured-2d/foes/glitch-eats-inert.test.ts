// foes/glitch-eats-inert — a glitch removes the inert node it is standing on.
//
// specs/foes.md: "A glitch removes the node on the tile its center occupies,
// whatever that node's charge." The node is posed INERT, at charge `0`, and what
// is graded is the FIRST change the glitch made to the tile: removal leaves it
// EMPTY, and specs/nodes.md keeps empty and inert distinct — a bolt into an
// inert node "is removed and its tile is left empty" — so the harness reports an
// empty tile as `null` rather than as `0`. A build that de-energizes instead of
// removing changes nothing at all here, and is named for it.
//
// Reading the first change rather than the tile at the end of a window is what
// keeps the wrong answers apart: specs/foes.md fixes a foe's effect as an
// OCCUPANCY, so a build acts again on every update it stands there and a window
// of any width would grade the tile after several of those acts.
//
// The glitch is posed with its locomotion held. specs/foes.md fixes a foe's
// effect as the occupancy of the tile its center is on, so a still glitch acts
// on exactly the tile it was placed on and the scenario carries no motion at all
// — nothing here can fail for a reason the item does not name.

import { afterEach, beforeEach, it } from "vitest";
import { assertNull } from "../assert";
import {
  captureStill,
  createHarness,
  resetTo,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { poseStillFoe, untilTileChanges } from "./harness";

/** The tile the glitch stands on: clear of the band and of the entry row. */
const TILE_C = 10;
const TILE_R = 8;

/** The charge the node is posed at: inert, per specs/nodes.md's charge table. */
const INERT = 0;

/**
 * How long the glitch is given to act at all.
 *
 * specs/foes.md fixes no cadence for a foe's effect, so this is a bound rather
 * than a figure: a quarter second, thirty frames of the suite's clock, is every
 * chance a build needs to act on the one tile it is standing on. What is graded
 * is the first change inside it, so the width of the bound decides nothing but
 * how long a build that never acts is waited for.
 */
const ACT_SECONDS = 0.25;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("removes the inert node the glitch is standing on", async () => {
  resetTo(h);
  startPlaying(h);
  h.debug.setNode(TILE_C, TILE_R, INERT);
  poseStillFoe(h, "glitch", TILE_C, TILE_R);

  const change = await untilTileChanges(
    h,
    TILE_C,
    TILE_R,
    ticksFor(ACT_SECONDS),
  );
  captureStill(h, "eaten");

  assertNull(
    change.now,
    `the glitch's first act on the charge-${INERT} node on (${TILE_C}, ` +
      `${TILE_R}) leaves that tile empty`,
  );
});
