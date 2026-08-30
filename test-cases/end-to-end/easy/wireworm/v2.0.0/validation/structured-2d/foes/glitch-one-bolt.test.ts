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
// darts nor eats, so the only thing that can empty the roster is the bolt.

import { afterEach, beforeEach, it } from "vitest";
import { assertUndefined } from "../assert";
import { BOLT_SPEED, FOE_HALF } from "../../src/constants";
import {
  captureStill,
  createHarness,
  foeById,
  poseBolt,
  resetTo,
  startPlaying,
  tileCenter,
  type Harness,
} from "../harness";
import { poseStillFoe } from "./harness";

/** The tile the glitch stands on: clear of the band and of the entry row. */
const TILE_C = 10;
const TILE_R = 8;

/**
 * How far below the glitch's center the bolt starts: far enough to begin
 * outside the foe's FOE_HALF box, so the bolt has to travel into it.
 */
const APPROACH = 60;

/**
 * How long the bolt is given to climb. At BOLT_SPEED it covers the approach
 * many times over, so a glitch still standing when this runs out is one the
 * bolt did not destroy.
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
  resetTo(h);
  startPlaying(h);
  const id = poseStillFoe(h, "glitch", TILE_C, TILE_R);
  h.debug.setFoeMind(id, false);

  const center = tileCenter(TILE_C, TILE_R);
  poseBolt(h, center.x, center.y + APPROACH);
  await h.advanceSeconds(FLIGHT_SECONDS);
  captureStill(h, "killed");

  assertUndefined(
    foeById(h.snapshot(), id),
    `the glitch is gone from the roster after one bolt climbing ${APPROACH} ` +
      `units at BOLT_SPEED ${BOLT_SPEED} into its ${FOE_HALF}-unit box`,
  );
});
