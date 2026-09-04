// Wireworm — nodes/shot-leaves-node: a shot-killed segment leaves an inert node.
//
// specs/nodes.md, "How the field grows": "Every worm segment destroyed by a bolt
// leaves a fresh node at charge `0` on the tile it died on." That is how the
// field a player fights over is replenished, and it is the half of the rule that
// separates a bolt from a discharge: "A segment destroyed by a discharge leaves
// nothing," which is `discharge.fry-leaves-no-node`'s requirement.
//
// The worm is posed with BOTH FACULTIES OFF — no step and no body — so the tile
// the segment dies on is the tile it was posed on, and this point reads the node
// rather than the worm's cadence. It carries two segments so that killing one
// does not empty the board: a level clears on the step in which the last of its
// segments is removed (specs/progression.md), and a clear would put a banner over
// the evidence this point captures.
//
// The head's tile is posed EMPTY, so the node read afterwards is the one the kill
// laid. Every wrong model reads differently: a build that laid nothing reads
// absent, one that laid a charged node reads above `0`, and only a build that
// laid the fresh inert node the rule names reads `0`.

import { afterEach, beforeEach, it } from "vitest";
import { BOLT_SPEED, TILE } from "../../src/constants";
import { assertEqual } from "../assert";
import {
  captureStill,
  chargeAt,
  createHarness,
  poseBoltAtTile,
  poseWorm,
  startPlaying,
  type Harness,
} from "../harness";

/** The head's tile: mid-board, clear of the entry row and of the player band. */
const HEAD_C = 10;
const HEAD_R = 12;

/** The tile the bolt starts on, directly below the head's, climbing into it. */
const FROM_R = HEAD_R + 1;

/** Segments the worm carries, so the kill leaves one standing and no level clears. */
const LENGTH = 2;

/** The charge specs/nodes.md fixes for the node a shot-killed segment leaves. */
const LEFT = 0;

/**
 * Seconds of flight run.
 *
 * A bolt climbs at `BOLT_SPEED` (`900` units per second, specs/cursor.md), so it
 * covers the half-tile from the centre of the tile below to the head's tile in
 * `TILE / 2 / BOLT_SPEED` (`0.018` s). Five times that is well past the strike
 * and still only three tiles of travel.
 */
const FLIGHT = (5 * (TILE / 2)) / BOLT_SPEED;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("leaves an inert node on the tile the shot-killed segment died on", async () => {
  startPlaying(h);
  // Heading right, so the trailing segment lies to the left and the bolt's
  // column holds the head alone.
  const worm = poseWorm(h, HEAD_C, HEAD_R, LENGTH, 1, 1);
  h.debug.setWormStepping(worm, false);
  h.debug.setWormBody(worm, false);
  poseBoltAtTile(h, HEAD_C, FROM_R);

  await h.advanceSeconds(FLIGHT);
  captureStill(h, "node");

  assertEqual(
    chargeAt(h.snapshot(), HEAD_C, HEAD_R),
    LEFT,
    `the charge on tile (${HEAD_C}, ${HEAD_R}), where the segment died`,
  );
});
