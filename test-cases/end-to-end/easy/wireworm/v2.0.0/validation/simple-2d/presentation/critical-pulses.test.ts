// presentation/critical-pulses — a critical node visibly pulses.
//
// specs/assets.md, on `assets/node/`: it seeds five frames, "one per charge
// state, plus a second critical frame", and states the rule outright — "A node at
// charge `3` alternates frames `3` and `4` at `NODE_PULSE_FPS` (`6`) frames per
// second, so a critical node visibly pulses. A node below charge `3` holds the
// single frame for its charge." A critical node is the one a bolt detonates and
// the one a worm dives on (specs/nodes.md, specs/worm.md), so the pulse is how a
// player finds it before it finds them.
//
// THE READING IS THE IMAGE SOURCE ITSELF, over a whole second of frames: which
// seeded frame the build handed the context on each of them, matched against the
// PNGs read off the workspace's own `assets/` tree. Reading the source rather
// than the pixels is what tells a pulse apart from a glow a build animates in
// code around a static frame.
//
// WHAT IS ASSERTED IS THE ALTERNATION, NOT ITS RATE. specs/assets.md fixes
// `NODE_PULSE_FPS`, but this point is the one that says the node pulses at all,
// and its requirement is the sentence's own: the drawn frame takes two different
// values of `assets/node/` and keeps returning to them. Two changes is the floor
// — a single switch is a node that changed its mind once, and two is the least
// that can be called alternating — against the six a build running at
// `NODE_PULSE_FPS` makes in the second this point watches, so the bar names a
// build that does not pulse rather than one whose cadence is its own.
//
// ONE CRITICAL NODE, ALONE ON THE BOARD, mid-board and far from the player band,
// so every draw attributed to its tile is its own. Nothing else is posed: the
// pulse is a property of the node's own drawing and needs no other body.

import { afterEach, beforeEach, it } from "vitest";
import { CHARGE_MAX, TILE, tileCX, tileCY } from "../constants";
import { assertGreaterThanOrEqual, assertTrue } from "../assert";
import {
  captureStill,
  createHarness,
  drawnImages,
  startPlaying,
  ticksFor,
  type Harness,
} from "../harness";
import { framesDrawnAt, spriteReader } from "./reading";

/**
 * How far a draw's destination centre may sit from the node it is attributed to,
 * in logical units.
 *
 * specs/board.md: "A node fills its tile and is drawn centered on that point", so
 * half a tile (`TILE / 2`, `16`) is the whole of the slack. This board holds one
 * node, so nothing can be attributed to anything else.
 */
const ATTRIBUTION_MAX = TILE / 2;

/** The tile the critical node stands on: mid-board, far from the band. */
const NODE_C = 20;
const NODE_R = 8;

/** The window the pulse is watched over, in frames: one second of game time. */
const WATCH_TICKS = ticksFor(1);

/** How many frames of `assets/node/` the drawn source has to take over it. */
const DISTINCT_FRAMES_MIN = 2;

/**
 * How many times the drawn source has to change over the window.
 *
 * One change is a node that switched frame once; two is the least that can be
 * called an alternation, since the second is the first returning. A build
 * alternating at `NODE_PULSE_FPS` (`6`) makes six of them in this second, so this
 * bar names a build whose critical node holds one frame rather than one whose
 * cadence differs from the reference's.
 */
const CHANGES_MIN = 2;

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(() => {
  h?.dispose();
});

it("alternates a critical node between two frames of assets/node/", async () => {
  startPlaying(h);
  h.debug.setNode(NODE_C, NODE_R, CHARGE_MAX);

  const read = spriteReader();
  const shown: number[] = [];
  for (let frame = 0; frame < WATCH_TICKS; frame += 1) {
    h.calls.length = 0;
    await h.advance(1);
    const matches = await framesDrawnAt(
      read,
      drawnImages(h),
      tileCX(NODE_C),
      tileCY(NODE_R),
      ATTRIBUTION_MAX,
    );
    const node = matches.find((match) => match.folder === "node");
    if (node !== undefined) shown.push(node.index);
  }
  captureStill(h, "pulse");

  assertTrue(
    shown.length === WATCH_TICKS,
    `every one of the ${WATCH_TICKS} frames of this second drawing the ` +
      `critical node on tile (${NODE_C}, ${NODE_R}) from a frame of ` +
      "assets/node/ (specs/assets.md), which is what a pulse is read off — " +
      `${shown.length} of them did`,
  );

  const distinct = new Set(shown);
  assertGreaterThanOrEqual(
    distinct.size,
    DISTINCT_FRAMES_MIN,
    "the frames of assets/node/ a critical node was drawn from over one " +
      "second (specs/assets.md: a node at charge 3 alternates frames 3 and 4, " +
      `so a critical node visibly pulses) — it was drawn from ` +
      `${[...distinct].sort().join(" and ")} throughout`,
  );

  const changes = shown.filter(
    (index, at) => at > 0 && index !== shown[at - 1],
  ).length;
  assertGreaterThanOrEqual(
    changes,
    CHANGES_MIN,
    "the times the drawn frame changed over one second, which is what makes " +
      "the two frames an alternation rather than a single switch " +
      "(specs/assets.md)",
  );
});
