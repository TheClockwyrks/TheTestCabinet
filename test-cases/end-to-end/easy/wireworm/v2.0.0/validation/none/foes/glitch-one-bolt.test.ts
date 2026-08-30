// foes/glitch-one-bolt — one bolt destroys a glitch.
//
// `specs/foes.md` fixes the glitch's "Bolts to destroy it" at `1`, and
// `specs/cursor.md` fixes when a bolt reaches a foe: "The bolt's center is
// inside the foe's box, FOE_HALF (12) units from the foe's center on each axis",
// after which "a bolt resolves against exactly one thing and is removed from
// flight in the same update".
//
// So ONE bolt is placed climbing the glitch's own column, from below it and well
// clear of that box, and the roster is read once the bolt has certainly climbed
// past where the glitch stands. The reading is the glitch's absence: a build
// that needs a second bolt leaves it standing and is named for it.
//
// BOTH OF THE GLITCH'S FACULTIES ARE HELD. With `setFoeTravel` off it cannot
// descend out of the bolt's way, and with `setFoeMind` off it neither darts nor
// eats, so nothing in this scenario but the bolt can empty the roster. The board
// `startPlaying` leaves is empty, so nothing stands in the column between the
// two — `specs/cursor.md` has a bolt resolve against the LOWEST thing above it,
// and here that is the glitch.

import { afterEach, beforeEach, it } from "vitest";
import { BOLT_SPEED, FOE_HALF, TILE } from "../constants";
import { assertUndefined } from "../assert";
import {
  captureStill,
  createHarness,
  foeById,
  framesFor,
  poseBolt,
  poseFoe,
  startPlaying,
  type Harness,
} from "../harness";

/** The tile the glitch stands on: clear of the entry row and of the band. */
const TILE_C = 10;
const TILE_R = 8;

/**
 * How far below the glitch the bolt is posed, in tiles. Two tiles is `64` units
 * between the two centers, which starts the bolt well outside the `FOE_HALF`
 * box, so it has to travel into it rather than beginning inside it.
 */
const APPROACH_TILES = 2;
const APPROACH = APPROACH_TILES * TILE;

/**
 * How long the bolt is given to climb, in seconds.
 *
 * At `BOLT_SPEED` the bolt's center covers the `APPROACH` in `0.071` s and has
 * left the glitch's tile entirely by `0.09` s, so a fifth of a second is the
 * whole encounter, twice over. A glitch still on the roster after it is one the
 * bolt did not destroy.
 */
const FLIGHT_SECONDS = 0.2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("removes the glitch a single bolt reaches", async () => {
  await startPlaying(h);
  const id = await poseFoe(h, "glitch", TILE_C, TILE_R, {
    mind: false,
    travel: false,
  });

  await poseBolt(h, TILE_C, TILE_R + APPROACH_TILES);
  await h.advance(framesFor(FLIGHT_SECONDS));

  await captureStill(h, "killed");
  assertUndefined(
    foeById(await h.snapshot(), id),
    `the glitch is gone from the roster after one bolt climbing ${APPROACH} ` +
      `units at BOLT_SPEED ${BOLT_SPEED} into its ${FOE_HALF}-unit box`,
  );
});
