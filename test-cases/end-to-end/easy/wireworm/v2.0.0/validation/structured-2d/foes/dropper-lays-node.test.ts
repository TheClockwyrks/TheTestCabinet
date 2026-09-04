// foes/dropper-lays-node — a dropper lays a fresh inert node on an empty tile.
//
// specs/foes.md: "A dropper lays a fresh node at charge 0 on the tile its center
// occupies whenever that tile is empty and lies in rows 1 to 17."
//
// The tile is posed EMPTY and inside the scatter rows, and what is graded is the
// FIRST change the dropper made to it. A node laid at charge `0` is the answer
// the specification asks for; a node laid at any other charge is named by the
// number it came out at, and a tile that never changes is named as one the
// dropper laid nothing on. Reading the first change rather than the tile at the
// end of a window is what keeps those apart: specs/foes.md fixes a foe's effect
// as an OCCUPANCY, so a build acts again on every update it stands there.
//
// The dropper is posed with its locomotion held, so it lays on exactly the tile
// it was placed on and no other tile in the scenario is touched.

import { afterEach, beforeEach, it } from "vitest";
import { assertEqual } from "../assert";
import { SCATTER_BOTTOM_ROW, SCATTER_TOP_ROW } from "../../src/constants";
import {
  captureStill,
  createHarness,
  resetTo,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { clearForStill, poseStillFoe, untilTileChanges } from "./harness";

/** The tile the dropper stands on: empty, and inside the scatter rows. */
const TILE_C = 10;
const TILE_R = 8;

/** The charge specs/foes.md fixes a laid node at: inert. */
const LAID_CHARGE = 0;

/**
 * How long the dropper is given to act at all.
 *
 * specs/foes.md fixes no cadence for a foe's effect, so this is a bound rather
 * than a figure: a quarter second, thirty frames of the suite's clock, is every
 * chance a build needs to lay on the one tile it is standing on. What is graded
 * is the first change inside it.
 */
const ACT_SECONDS = 0.25;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("lays an inert node on the empty tile the dropper stands on", async () => {
  resetTo(h);
  startPlaying(h);
  // `startPlaying` empties the field, so what the dropper finds on the tile
  // below is nothing.
  const id = poseStillFoe(h, "dropper", TILE_C, TILE_R);

  const change = await untilTileChanges(
    h,
    TILE_C,
    TILE_R,
    ticksFor(ACT_SECONDS),
  );
  await clearForStill(h, id);
  captureStill(h, "laid");

  assertEqual(
    change.now,
    LAID_CHARGE,
    `the dropper lays a fresh node at charge ${LAID_CHARGE} on its empty ` +
      `tile (${TILE_C}, ${TILE_R}), which lies in the scatter rows ` +
      `${SCATTER_TOP_ROW} to ${SCATTER_BOTTOM_ROW}`,
  );
});
