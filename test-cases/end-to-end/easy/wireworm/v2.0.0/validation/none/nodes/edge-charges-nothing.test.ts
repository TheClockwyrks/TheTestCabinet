// nodes/edge-charges-nothing — a worm turned by the side edge charges nothing.
//
// specs/nodes.md draws the boundary in one sentence: "A worm turned by the side
// edge of the board or by a worm segment changes no node's charge." specs/worm.md
// lists the three things that block a horizontal step — off the board, a node, a
// worm segment — and only the middle one carries the rise.
//
// WHAT MAKES THIS SENSITIVE. A build that charges "whatever is on the tile the
// step was aimed at" has nothing to charge here, and so would pass an empty
// board no matter what it did. The two failures that are real are therefore
// posed for: a build that charges the tile the head is standing on, and one that
// reverses the heading FIRST and then charges the tile the new heading points at
// — the tile BEHIND the head. Both are given a node, at charge `2`, which is the
// value that tells the wrong models apart: charged reads `3`, cleared reads
// absent, replaced by a fresh inert node reads `0`, de-energized reads `1`.
// Distant nodes at three more charges are posed alongside, so a build that
// disturbs the field anywhere is named as well.
//
// The head is on the last column, so the step is blocked by the edge and nothing
// else, and the tile the turn drops the head into is left EMPTY: what a drop does
// to a node standing under it is nodes/drop-leaves-charge's requirement, and
// putting a node there would grade it twice.
//
// NO TOLERANCE APPLIES: the field is compared node for node, charge for charge.

import { afterEach, beforeEach, it } from "vitest";
import { assertDeepEqual } from "../assert";
import { CHARGE_MAX, COLS } from "../constants";
import {
  captureStill,
  createHarness,
  driveSteps,
  poseNodes,
  poseWorm,
  startPlaying,
  type Harness,
  type NodeView,
  type WirewormSnapshot,
} from "../harness";

/** The head's tile: the last column, so a rightward step runs into the edge. */
const HEAD = { c: COLS - 1, r: 8 } as const;

/**
 * The field the turn must leave alone.
 *
 * `(38, 8)` is the tile the head's REVERSED heading points at, and `(20, 8)`,
 * `(HEAD.c, 12)` and `(6, 15)` are witnesses far enough away that only a build
 * disturbing the field wholesale reaches them. The tile the turn drops the head
 * into, `(HEAD.c, 9)`, is deliberately left empty.
 */
const FIELD: readonly (readonly [number, number, number])[] = [
  [HEAD.c - 1, HEAD.r, 2],
  [20, 8, 1],
  [HEAD.c, 12, CHARGE_MAX],
  [6, 15, 0],
];

/** The drive: exactly the one step the edge turns the worm on. */
const STEPS = 1;

/** The field as a stable list, so two readings compare by content alone. */
function field(snapshot: WirewormSnapshot): NodeView[] {
  return [...snapshot.nodes].sort((a, b) => a.r - b.r || a.c - b.c);
}

let h: Harness;

beforeEach(async () => {
  h = await createHarness();
});

afterEach(async () => {
  await h.dispose();
});

it("leaves every node's charge alone when the side edge turns the worm", async () => {
  await startPlaying(h);
  await poseNodes(h, FIELD);
  await poseWorm(h, { c: HEAD.c, r: HEAD.r, length: 1, dh: 1, dv: 1 });
  const before = field(await h.snapshot());

  await driveSteps(h, STEPS);
  await captureStill(h, "edge");

  assertDeepEqual(
    field(await h.snapshot()),
    before,
    "the node field after the edge turned the worm",
  );
});
