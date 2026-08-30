// foes/dropper-second-bolt-kills — a bolt into an already-hit dropper destroys
// it.
//
// specs/foes.md: "A bolt into a dropper whose hit flag is already set destroys
// it."
//
// The flag is POSED rather than earned: `setFoeHit(id, true)`
// (specs/instrumentation.md) puts the dropper in the state this rule is written
// about, so the check decides what a bolt does to a hit dropper and nothing
// about what the first bolt does — that is foes/dropper-first-bolt-survives's
// requirement, and a build that got it wrong is docked there rather than twice.
//
// specs/cursor.md fixes when the bolt reaches it: "The bolt's center is inside
// the foe's box, FOE_HALF (12) units from the foe's center on each axis." The
// bolt is placed climbing the dropper's own column from below and clear of that
// box. Both of the dropper's faculties are held, so it cannot fall out of the
// way and lays nothing while the bolt climbs.

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

/** The tile the dropper stands on: clear of the band and of the entry row. */
const TILE_C = 10;
const TILE_R = 2;

/**
 * How far below the dropper the bolt is posed, in tiles. Two tiles is `64`
 * units between the two centers, which begins the bolt well outside the foe's
 * FOE_HALF box, so it has to travel into it.
 */
const APPROACH_TILES = 2;
const APPROACH = APPROACH_TILES * TILE;

/**
 * How long the bolt is given to climb: twice over. At BOLT_SPEED the approach
 * takes `0.071` s, so a dropper still standing after `0.2` s is one the bolt
 * did not destroy.
 */
const FLIGHT_SECONDS = 0.2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("removes a dropper that was already hit when the bolt reached it", async () => {
  startPlaying(h);
  const id = poseStillFoe(h, "dropper", TILE_C, TILE_R);
  h.debug.setFoeMind(id, false);
  h.debug.setFoeHit(id, true);

  poseBolt(h, TILE_C, TILE_R + APPROACH_TILES);
  await h.advance(ticksFor(FLIGHT_SECONDS));
  captureStill(h, "killed");

  assertNull(
    heldFoe(h.snapshot(), id),
    `the already-hit dropper is gone from the roster after one bolt climbing ` +
      `${APPROACH} units at BOLT_SPEED ${BOLT_SPEED} into its ` +
      `${FOE_HALF}-unit box`,
  );
});
