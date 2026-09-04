// foes/glitch-one-bolt — one bolt destroys a glitch.
//
// specs/foes.md fixes the glitch's "Bolts to destroy it" at `1`, and
// specs/cursor.md fixes when a bolt reaches a foe: "The bolt's center is inside
// the foe's box, FOE_HALF (12) units from the foe's center on each axis", after
// which "a bolt resolves against exactly one thing and is removed from flight in
// the same update".
//
// So the check places ONE bolt climbing the glitch's own column, from below it
// and clear of it, and reads the roster once the bolt has certainly climbed past
// where the glitch stands. Both of the glitch's faculties are held: with travel
// off it cannot move out of the bolt's way, and with its mind off it neither
// darts nor eats, so the only thing that can empty the roster is the bolt. The
// board `startPlaying` leaves is empty, so nothing stands between the two.

import { afterEach, beforeEach, it } from "vitest";
import { BOLT_SPEED, FOE_HALF, TILE } from "../../src/constants";
import { assertNull } from "../assert";
import {
  captureStill,
  createHarness,
  poseBolt,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { heldFoe, poseStillFoe } from "./harness";

/** The tile the glitch stands on: clear of the band and of the entry row. */
const TILE_C = 10;
const TILE_R = 8;

/**
 * How far below the glitch the bolt is posed, in tiles. Two tiles is `64`
 * units between the two centers, which begins the bolt well outside the foe's
 * FOE_HALF box, so it has to travel into it.
 */
const APPROACH_TILES = 2;
const APPROACH = APPROACH_TILES * TILE;

/**
 * How long the bolt is given to climb: twice over. At BOLT_SPEED the approach
 * takes `0.071` s, so a glitch still standing after `0.2` s is one the bolt did
 * not destroy.
 */
const FLIGHT_SECONDS = 0.2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("removes the glitch a single bolt reaches", async () => {
  startPlaying(h);
  const id = poseStillFoe(h, "glitch", TILE_C, TILE_R);
  h.debug.setFoeMind(id, false);

  poseBolt(h, TILE_C, TILE_R + APPROACH_TILES);
  await h.advance(ticksFor(FLIGHT_SECONDS));
  captureStill(h, "killed");

  assertNull(
    heldFoe(h.snapshot(), id),
    `the glitch is gone from the roster after one bolt climbing ${APPROACH} ` +
      `units at BOLT_SPEED ${BOLT_SPEED} into its ${FOE_HALF}-unit box`,
  );
});
