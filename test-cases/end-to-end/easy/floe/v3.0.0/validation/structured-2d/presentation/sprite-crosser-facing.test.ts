// Floe — presentation/sprite-crosser-facing: the frame the critter is drawn from
// is the pair for the facing it is currently in.
//
// specs/assets.md tabulates `assets/crosser/` as "a two-frame crouch-and-leap
// pair for each of the four facings" — `0`,`1` down, `2`,`3` up, `4`,`5` left,
// `6`,`7` right — and says "Draw the critter from the pair for its current
// facing". `presentation/sprite-crosser` already decides that the folder is
// reached for at all; this point decides that the RIGHT PAIR of it is.
//
// ALL FOUR FACINGS, EACH READ ON ITS OWN. A build that wired one facing and left
// the other three on frame `0` reads three wrong pairs here, and the failure
// names which. The four are one point because the requirement is the table, and a
// build either follows it or does not.
//
// THE READING IS EXCLUSIVE, NOT MERELY INCLUSIVE: every crosser frame drawn on
// the critter must belong to the facing's pair. Asserting only that one of the
// two was among them would pass a build that blits all eight frames on top of
// each other. The eight seeded frames are pixel-for-pixel distinct, so a match
// names exactly one of them.
//
// THE FACING IS POSED rather than hopped to. What a hop does to the facing is
// `hopping/facing-follows-hop`'s point; what this one decides is the drawing that
// follows from a facing, so the critter is posed into each of the four in turn
// and nothing else about the world moves. The world is the empty crossing
// `startCrossing` poses, and the lives icon specs/assets.md allows in the HUD is
// eight rows from the critter and outside what is read.

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

/** The four facings specs/assets.md tabulates, read in turn. */
const FACINGS: readonly Facing[] = ["down", "up", "left", "right"];

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("draws the critter from the pair for each facing in turn", async () => {
  startCrossing(h);

  const drawn = new Map<Facing, number[]>();
  for (const facing of FACINGS) {
    h.debug.setCritterFacing(facing);
    const sprites = await spritesOfFrame(h);
    const { critter } = h.snapshot();
    drawn.set(
      facing,
      frameIndexes(
        drawnFrom(sprites, "crosser", critter, CENTRED_WITHIN),
        "crosser",
      ),
    );
  }
  // Before the assertions, so a failing check still leaves the last facing read.
  captureStill(h, "scene");

  for (const facing of FACINGS) {
    const pair = CROSSER_FRAMES_BY_FACING[facing];
    const indexes = drawn.get(facing) ?? [];
    assertGreaterThanOrEqual(
      indexes.length,
      1,
      `facing ${facing}: the critter drawn from a frame of assets/crosser/`,
    );
    assertLength(
      indexes.filter((index) => !pair.includes(index)),
      0,
      `facing ${facing}: every frame drawn on the critter from that facing's ` +
        `pair, ${pair.join(" or ")} (specs/assets.md) — drew ` +
        `${indexes.join(", ")}`,
    );
  }
});
