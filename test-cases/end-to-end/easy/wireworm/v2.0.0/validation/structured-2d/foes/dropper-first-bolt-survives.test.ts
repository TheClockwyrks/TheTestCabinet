// foes/dropper-first-bolt-survives — the first bolt into a dropper does not
// destroy it.
//
// specs/foes.md: "The first bolt into a dropper does not destroy it. It sets the
// dropper's hit flag ... A bolt into a dropper whose hit flag is already set
// destroys it." The dropper is posed FRESH — `addFoe` gives it "its hit flag
// false" (specs/instrumentation.md) — so the one bolt this check places is its
// first, and both halves of the outcome are read off the same roster: the
// dropper is still on it, and the flag it carries has been set.
//
// specs/cursor.md fixes when the bolt reaches it: "The bolt's center is inside
// the foe's box, FOE_HALF (12) units from the foe's center on each axis." The
// bolt is placed climbing the dropper's own column from below and clear of that
// box, so it has to travel into it.
//
// Both of the dropper's faculties are held. With travel off it cannot fall out
// of the bolt's way, and with its mind off it lays no node, so the only thing
// the frames of the flight change is what the bolt did.

import { afterEach, beforeEach, it } from "vitest";
import { assertDefined, assertEqual } from "../assert";
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
 * many times over, so what the roster holds when this runs out is what the bolt
 * left behind.
 */
const FLIGHT_SECONDS = 0.2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves the dropper standing, and hit, after one bolt", async () => {
  resetTo(h);
  startPlaying(h);
  const id = poseStillFoe(h, "dropper", TILE_C, TILE_R);
  h.debug.setFoeMind(id, false);

  const center = tileCenter(TILE_C, TILE_R);
  poseBolt(h, center.x, center.y + APPROACH);
  await h.advanceSeconds(FLIGHT_SECONDS);
  captureStill(h, "hit");

  const dropper = foeById(h.snapshot(), id);
  assertDefined(
    dropper,
    `the dropper is still on the roster after one bolt climbing ${APPROACH} ` +
      `units at BOLT_SPEED ${BOLT_SPEED} into its ${FOE_HALF}-unit box`,
  );
  assertEqual(dropper?.hit, true, "that first bolt set the dropper's hit flag");
});
