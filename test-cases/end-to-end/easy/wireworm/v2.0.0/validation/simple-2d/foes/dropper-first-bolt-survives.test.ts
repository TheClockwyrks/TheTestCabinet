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
import { BOLT_SPEED, FOE_HALF, TILE } from "../../src/constants";
import { assertEqual, assertNotNull } from "../assert";
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
 * takes `0.071` s, so what the roster holds after `0.2` s is what the bolt left
 * behind.
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
  startPlaying(h);
  const id = poseStillFoe(h, "dropper", TILE_C, TILE_R);
  h.debug.setFoeMind(id, false);

  poseBolt(h, TILE_C, TILE_R + APPROACH_TILES);
  await h.advance(ticksFor(FLIGHT_SECONDS));
  captureStill(h, "hit");

  const dropper = heldFoe(h.snapshot(), id);
  assertNotNull(
    dropper,
    `the dropper is still on the roster after one bolt climbing ${APPROACH} ` +
      `units at BOLT_SPEED ${BOLT_SPEED} into its ${FOE_HALF}-unit box`,
  );
  assertEqual(dropper?.hit, true, "that first bolt set the dropper's hit flag");
});
