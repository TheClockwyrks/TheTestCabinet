// foes/dropper-second-bolt-kills — a bolt into an already-hit dropper destroys
// it.
//
// `specs/foes.md`: "A bolt into a dropper whose hit flag is already set destroys
// it."
//
// THE FLAG IS POSED RATHER THAN EARNED. `setFoeHit(id, true)`
// (`specs/instrumentation.md`) puts the dropper straight into the state this
// rule is written about, so this point decides what a bolt does to a HIT dropper
// and nothing about what the first bolt does — that is
// foes/dropper-first-bolt-survives's requirement, and a build that got it wrong
// is docked there rather than a second time here. It also keeps the scenario to
// one bolt, so nothing about the cap or the cooldown can enter it.
//
// `specs/cursor.md` fixes when the bolt reaches it: "The bolt's center is inside
// the foe's box, FOE_HALF (12) units from the foe's center on each axis." The
// bolt is placed climbing the dropper's own column from below and clear of that
// box. Both of the dropper's faculties are held, so it can neither fall out of
// the way nor lay a node for the bolt to resolve against first.

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
 * left the dropper's box entirely by `0.09` s, so a dropper still standing after
 * a fifth of a second is one the bolt did not destroy.
 */
const FLIGHT_SECONDS = 0.2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h?.dispose();
});

it("removes a dropper that was already hit when the bolt reached it", async () => {
  await startPlaying(h);
  const id = await poseFoe(h, "dropper", TILE_C, TILE_R, {
    hit: true,
    mind: false,
    travel: false,
  });

  await poseBolt(h, TILE_C, TILE_R + APPROACH_TILES);
  await h.advance(framesFor(FLIGHT_SECONDS));

  await captureStill(h, "killed");
  assertUndefined(
    foeById(await h.snapshot(), id),
    `the already-hit dropper is gone from the roster after one bolt climbing ` +
      `${APPROACH} units at BOLT_SPEED ${BOLT_SPEED} into its ` +
      `${FOE_HALF}-unit box`,
  );
});
