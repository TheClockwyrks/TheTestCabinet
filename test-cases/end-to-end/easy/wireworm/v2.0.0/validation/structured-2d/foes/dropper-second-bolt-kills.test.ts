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

/** The tile the dropper stands on: clear of the band and of the entry row. */
const TILE_C = 10;
const TILE_R = 2;

/**
 * How far below the dropper's center the bolt starts: far enough to begin
 * outside the foe's FOE_HALF box, so the bolt has to travel into it.
 */
const APPROACH = 60;

/**
 * How long the bolt is given to climb. At BOLT_SPEED it covers the approach
 * many times over, so a dropper still standing when this runs out is one the
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

it("removes a dropper that was already hit when the bolt reached it", async () => {
  resetTo(h);
  startPlaying(h);
  const id = poseStillFoe(h, "dropper", TILE_C, TILE_R);
  h.debug.setFoeMind(id, false);
  h.debug.setFoeHit(id, true);

  const center = tileCenter(TILE_C, TILE_R);
  poseBolt(h, center.x, center.y + APPROACH);
  await h.advanceSeconds(FLIGHT_SECONDS);
  captureStill(h, "killed");

  assertUndefined(
    foeById(h.snapshot(), id),
    `the already-hit dropper is gone from the roster after one bolt climbing ` +
      `${APPROACH} units at BOLT_SPEED ${BOLT_SPEED} into its ` +
      `${FOE_HALF}-unit box`,
  );
});
