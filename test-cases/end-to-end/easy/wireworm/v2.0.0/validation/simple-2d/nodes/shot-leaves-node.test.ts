// nodes/shot-leaves-node — a segment a bolt destroyed leaves an inert node behind.
//
// specs/nodes.md, on how the field grows: "Every worm segment destroyed by a bolt
// leaves a fresh node at charge `0` on the tile it died on." specs/worm.md states
// the same from the worm's side, and separates it from the other route: "Every
// segment destroyed by a bolt leaves a node behind, and every segment destroyed by
// a discharge leaves nothing."
//
// THE TILE UNDER TEST IS EMPTY BEFORE THE SHOT, so what stands on it afterwards is
// what the kill laid and nothing else. The other half of the rule — "Where that
// tile already holds a node, no new node is laid and the standing node keeps the
// charge it had" — is `nodes.shared-tile-keeps-charge`'s requirement, and it is
// posed the opposite way for exactly that reason.
//
// THE WORM IS TWO SEGMENTS AND STANDS STILL. Both of its faculties are off, so
// specs/instrumentation.md leaves it taking no step and following nothing: the
// bolt strikes the head on the tile the pose put it on, rather than wherever a
// step had carried it. Two segments rather than one because a board whose last
// segment is removed clears the level (specs/progression.md), and the surviving
// tail keeps the level open so the reading is of a level being played.
//
// AN EMPTY TILE AND AN INERT NODE ARE DIFFERENT ANSWERS. `chargeAt` reports `null`
// for a tile that holds no node and `0` for a tile that holds an inert one, so a
// build that lays nothing reads `null` and one that lays a charged node reads its
// charge — three answers, and the failure names which.
//
// WHAT THIS DOES NOT DECIDE. That the bolt removes the segment it struck and
// leaves the worm one shorter is `worm.shot-head-shortens`'s requirement, and that
// the kill scores is `scoring.head-segment`'s. This point reads the tile alone.

import { afterEach, beforeEach, it } from "vitest";
import { BOLT_SPEED, TILE } from "../constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  chargeAt,
  createHarness,
  poseBolt,
  poseWorm,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";

/** The tile the struck segment stands on, clear of every edge and of the band. */
const SEG_C = 20;
const SEG_R = 10;

/** The charge specs/nodes.md leaves on the tile a shot segment died on. */
const FRESH_CHARGE = 0;

/** How far below the segment the bolt is posed, in tiles. */
const BOLT_DROP_TILES = 4;

/**
 * How long the bolt is given to reach the segment, in frames.
 *
 * specs/cursor.md has a bolt climb at `BOLT_SPEED` (`900` units per second) and
 * resolve when "the bolt's centre is inside the segment's tile". Posed four tiles
 * below it, its centre starts `3.5` tiles — `112` units — under that tile's lower
 * edge, which is `0.124` s of flight. Twice that is the budget, so a conforming
 * build has ample room and a build whose bolt never resolves still reaches a
 * verdict rather than running the suite out.
 */
const BOLT_TICKS = 2 * ticksFor(((BOLT_DROP_TILES - 0.5) * TILE) / BOLT_SPEED);

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("lays a fresh inert node on the tile a shot segment died on", async () => {
  startPlaying(h);
  // Head on the tile under test, its one trailing segment behind it along the
  // row; neither moves, so the bolt strikes the head where it was posed.
  const worm = poseWorm(h, SEG_C, SEG_R, 2, 1, 1);
  h.debug.setWormStepping(worm, false);
  h.debug.setWormBody(worm, false);
  poseBolt(h, SEG_C, SEG_R + BOLT_DROP_TILES);

  await h.until((s) => s.bolts.length === 0, { maxFrames: BOLT_TICKS });
  captureStill(h, "node");

  assertEqual(
    chargeAt(h.snapshot(), SEG_C, SEG_R),
    FRESH_CHARGE,
    `the node on tile (${SEG_C}, ${SEG_R}), where the bolt killed a segment`,
  );
});
