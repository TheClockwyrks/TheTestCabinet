// foes/dropper-first-bolt-survives — the first bolt into a dropper does not
// destroy it.
//
// `specs/foes.md`: "The first bolt into a dropper does not destroy it. It sets
// the dropper's hit flag ... A bolt into a dropper whose hit flag is already set
// destroys it."
//
// The dropper is posed FRESH — `addFoe` gives it "its hit flag false"
// (`specs/instrumentation.md`) — so the one bolt placed here is its first, and
// both halves of the outcome are read off the same roster: the dropper is still
// standing on it, and the flag it now carries is set. Read together they
// separate the models a build might have written: a build that destroys on the
// first bolt has no dropper to read, and a build that spares it but never marks
// it reads `false` and would spare the second bolt too.
//
// `specs/cursor.md` fixes when the bolt reaches it: "The bolt's center is inside
// the foe's box, FOE_HALF (12) units from the foe's center on each axis." The
// bolt is placed climbing the dropper's own column from below and clear of that
// box, so it has to travel into it.
//
// BOTH OF THE DROPPER'S FACULTIES ARE HELD. With `setFoeTravel` off it cannot
// fall out of the bolt's way, and with `setFoeMind` off it lays no node the bolt
// might resolve against first, so what the roster holds afterwards is what the
// bolt left behind.

import { afterEach, beforeEach, it } from "vitest";
import { BOLT_SPEED, FOE_HALF, TILE } from "../constants";
import { assertDefined, assertEqual } from "../assert";
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

/** The tile the dropper stands on: clear of the entry row and of the band. */
const TILE_C = 10;
const TILE_R = 2;

/**
 * How far below the dropper the bolt is posed, in tiles. Two tiles is `64` units
 * between the two centers, which starts the bolt well outside the `FOE_HALF`
 * box, so it has to travel into it rather than beginning inside it.
 */
const APPROACH_TILES = 2;
const APPROACH = APPROACH_TILES * TILE;

/**
 * How long the bolt is given to climb, in seconds.
 *
 * At `BOLT_SPEED` the bolt's center covers the `APPROACH` in `0.071` s and has
 * left the dropper's box entirely by `0.09` s, so a fifth of a second is the
 * whole encounter, twice over.
 */
const FLIGHT_SECONDS = 0.2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("leaves the dropper standing, and hit, after one bolt", async () => {
  await startPlaying(h);
  const id = await poseFoe(h, "dropper", TILE_C, TILE_R, {
    mind: false,
    travel: false,
  });

  await poseBolt(h, TILE_C, TILE_R + APPROACH_TILES);
  await h.advance(framesFor(FLIGHT_SECONDS));

  await captureStill(h, "hit");
  const dropper = foeById(await h.snapshot(), id);
  assertDefined(
    dropper,
    `the dropper is still on the roster after one bolt climbing ${APPROACH} ` +
      `units at BOLT_SPEED ${BOLT_SPEED} into its ${FOE_HALF}-unit box`,
  );
  assertEqual(
    dropper?.hit,
    true,
    "that first bolt set the dropper's hit flag, which is what makes the " +
      "next one destroy it",
  );
});
