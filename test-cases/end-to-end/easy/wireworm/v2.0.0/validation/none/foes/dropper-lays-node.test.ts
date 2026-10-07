// foes/dropper-lays-node — a dropper lays a fresh inert node on an empty tile.
//
// `specs/foes.md`: "A dropper lays a fresh node at charge 0 on the tile its
// center occupies whenever that tile is empty and lies in rows 1 to 17."
//
// The tile is posed EMPTY — `startPlaying` clears the field, so what the dropper
// finds beneath it is nothing — and it lies inside those rows. What is graded is
// the FIRST change the dropper made to it: a node at charge `0` is the answer
// the specification asks for, a node at any other charge is named by the number
// it came out at, and a tile that never changes is named as one the dropper laid
// nothing on. Reading the first change rather than the tile at the end of a
// window is what keeps those apart, since `specs/foes.md` fixes a foe's effect
// as an occupancy and a build therefore acts again on every update it stands
// there.
//
// The dropper is posed with its locomotion held, so it lays on exactly the tile
// it was placed on and no other tile in the scenario is touched.

import { afterEach, beforeEach, it } from "vitest";
import { SCATTER_BOTTOM_ROW, SCATTER_TOP_ROW } from "../constants";
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

/** The tile the dropper stands on: empty, and inside the rows it lays in. */
const TILE_C = 10;
const TILE_R = 8;

/** The charge `specs/foes.md` fixes a laid node at: inert. */
const LAID_CHARGE = 0;

/**
 * How long the dropper is given to act at all, in seconds.
 *
 * `specs/foes.md` fixes no cadence for a foe's effect, so this is a bound rather
 * than a figure derived from one: a quarter second is every chance a build needs
 * to lay on the single tile it is standing on. What is graded is the first
 * change inside it.
 */
const ACT_SECONDS = 0.25;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("lays an inert node on the empty tile the dropper stands on", async () => {
  await startPlaying(h);
  await poseFoe(h, "dropper", TILE_C, TILE_R, { travel: false });

  const change = await untilTileChanges(
    h,
    TILE_C,
    TILE_R,
    framesFor(ACT_SECONDS),
  );

  await captureStill(h, "laid");
  assertEqual(
    change.now,
    LAID_CHARGE,
    `the dropper lays a fresh node at charge ${LAID_CHARGE} on its empty ` +
      `tile (${TILE_C}, ${TILE_R}), which lies in the rows ` +
      `${SCATTER_TOP_ROW} to ${SCATTER_BOTTOM_ROW} a dropper lays in`,
  );
});
