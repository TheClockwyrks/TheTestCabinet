// presentation/sprite-crosser-facing-left — the frame the critter is drawn from
// while it faces left is that facing's own pair.
//
// specs/assets.md tabulates `assets/crosser/` as "a two-frame crouch-and-leap
// pair for each of the four facings" — `0`,`1` down, `2`,`3` up, `4`,`5` left,
// `6`,`7` right — and says "Draw the critter from the pair for its current
// facing". `presentation/sprite-crosser` already decides that the folder is
// reached for at all; this point decides that the left pair of it is.
//
// THE FOUR FACINGS ARE FOUR POINTS. A build that wired one facing and left the
// other three on frame `0` must grade differently from one that wired none, and
// a single point over all four can only fail once. Each of the four poses its
// own facing and reads its own pair.
//
// THE READING IS EXCLUSIVE, NOT MERELY INCLUSIVE: every crosser frame drawn on
// the critter must belong to this facing's pair. Asserting only that one of the
// two was among them would pass a build that blits all eight frames on top of
// each other. The eight seeded frames are pixel-for-pixel distinct, so a match
// names exactly one of them.
//
// THE FACING IS POSED rather than hopped to. What a hop does to the facing is
// `hopping/faces-left`'s point; what this one decides is the drawing that follows
// from a facing, so the critter is posed into it and nothing else about the
// world moves. The world is the empty crossing `startCrossing` poses, and the
// lives icon specs/assets.md allows in the HUD is eight rows from the critter
// and outside what is read.

import { afterEach, beforeEach, it } from "vitest";
import { TILE } from "../constants";
import { assertGreaterThanOrEqual, assertLength } from "../assert";
import {
  captureStill,
  createHarness,
  startCrossing,
  type Facing,
  type Harness,
} from "../harness";
import {
  CROSSER_FRAMES_BY_FACING,
  drawnFrom,
  frameIndexes,
  spritesOfFrame,
} from "./sprites";

/**
 * How far a draw's centre may sit from the critter's own centre, in stage units.
 *
 * specs/assets.md draws a 32 x 32 frame "centered on its subject's own center".
 * Half a tile is the widest tolerance that still names one tile; the critter is
 * at rest on a tile centre here, so a conforming draw measures zero.
 */
const CENTRED_WITHIN = TILE / 2;

/** The facing this point poses and reads. */
const FACING: Facing = "left";

/** The two frames specs/assets.md gives that facing. */
const PAIR = CROSSER_FRAMES_BY_FACING[FACING];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the critter from its left pair while it faces left", async () => {
  startCrossing(h);
  h.debug.setCritterFacing(FACING);

  const sprites = await spritesOfFrame(h);
  const { critter } = h.snapshot();
  const indexes = frameIndexes(
    drawnFrom(sprites, "crosser", critter, CENTRED_WITHIN),
    "crosser",
  );
  // Before the assertions, so a failing check still leaves the frame it read.
  captureStill(h, "scene");

  assertGreaterThanOrEqual(
    indexes.length,
    1,
    `the critter drawn from a frame of assets/crosser/ while facing ${FACING}`,
  );
  assertLength(
    indexes.filter((index) => !PAIR.includes(index)),
    0,
    `every frame drawn on the critter from its ${FACING} pair, ` +
      `${PAIR.join(" or ")} (specs/assets.md) — drew ${indexes.join(", ")}`,
  );
});
